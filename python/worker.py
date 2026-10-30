"""Line-delimited JSON service. SQLite head is committed only after geometry validates.

Model code runs locally with the user's Python privileges, in a worker process that
the host can terminate. This is process isolation, not an operating-system sandbox.
"""
import argparse
import ast
import base64
import contextlib
import io
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import sys
import time
import traceback
import uuid
import zipfile
from html import escape


class Conflict(ValueError):
    pass


def json_text(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


def dimension_expression(expression, parameters):
    """Evaluate a dimension formula without allowing Python calls or attributes."""
    operators = {ast.Add: lambda a, b: a + b, ast.Sub: lambda a, b: a - b, ast.Mult: lambda a, b: a * b, ast.Div: lambda a, b: a / b}
    def evaluate(node):
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            return float(node.value)
        if isinstance(node, ast.Name) and type(parameters.get(node.id)) in (int, float):
            return float(parameters[node.id])
        if isinstance(node, ast.BinOp) and type(node.op) in operators:
            return operators[type(node.op)](evaluate(node.left), evaluate(node.right))
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
            return (-1 if isinstance(node.op, ast.USub) else 1) * evaluate(node.operand)
        raise ValueError("尺寸表达式只允许数字、参数名与加减乘除")
    if len(expression) > 500:
        raise ValueError("尺寸表达式过长")
    value = evaluate(ast.parse(expression, mode="eval").body)
    if not math.isfinite(value):
        raise ValueError("尺寸表达式结果无效")
    return value


class Store:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.root / "projects.sqlite3")
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, session_id TEXT UNIQUE,
                head INTEGER NOT NULL DEFAULT 0, created REAL, updated REAL);
            CREATE TABLE IF NOT EXISTS revisions (
                project_id TEXT, revision INTEGER, folder TEXT, summary TEXT, created REAL,
                PRIMARY KEY(project_id, revision));
            CREATE TABLE IF NOT EXISTS attachments (
                id TEXT PRIMARY KEY, project_id TEXT, name TEXT, pages INTEGER, bytes INTEGER);
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY, project_id TEXT, role TEXT, text TEXT, created REAL);
        """)
        if "model_selection" not in {r["name"] for r in self.db.execute("PRAGMA table_info(projects)")}:
            self.db.execute("ALTER TABLE projects ADD COLUMN model_selection TEXT NOT NULL DEFAULT ''")
            self.db.commit()

    def row(self, project_id):
        row = self.db.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if row is None:
            raise ValueError("设计任务不存在")
        return dict(row)

    def directory(self, project_id):
        self.row(project_id)
        return self.root / project_id

    def snapshot(self, project_id, revision=None):
        row = self.row(project_id)
        revision = row["head"] if revision is None else int(revision)
        if not revision:
            return None
        entry = self.db.execute("SELECT folder FROM revisions WHERE project_id=? AND revision=?", (project_id, revision)).fetchone()
        if entry is None:
            raise ValueError("版本不存在")
        folder = self.directory(project_id) / "revisions" / entry["folder"]
        return folder, json.loads((folder / "state.json").read_text(encoding="utf-8"))

    @staticmethod
    def ensure_views(folder, state):
        if state.get("projectionVersion") != 2:
            from build123d import import_brep
            state["views"] = projection_views(import_brep(folder / "model.brep"))
            state["projectionVersion"] = 2
        return state

    def project(self, project_id, geometry=True):
        result = self.row(project_id)
        result["modelSelection"] = result.pop("model_selection", "")
        result["directory"] = str(self.directory(project_id))
        saved = self.snapshot(project_id)
        result["design"] = saved[1] if saved else None
        if result["design"] and not geometry:
            result["design"] = {k: v for k, v in result["design"].items() if k not in ("mesh", "edges", "drawing", "views")}
        result["revisions"] = [dict(r) for r in self.db.execute("SELECT revision,summary,created FROM revisions WHERE project_id=? ORDER BY revision DESC", (project_id,))]
        result["attachments"] = [dict(r) for r in self.db.execute("SELECT id,name,pages,bytes FROM attachments WHERE project_id=?", (project_id,))]
        result["messages"] = [dict(r) for r in self.db.execute("SELECT id,role,text,created FROM messages WHERE project_id=? ORDER BY created", (project_id,))]
        return result

    def dispatch(self, method, args):
        if method == "health":
            from importlib.metadata import version
            return {"ready": True, "kernel": "build123d " + version("build123d"), "python": sys.version.split()[0]}
        if method == "list":
            return [dict(r) for r in self.db.execute("SELECT * FROM projects ORDER BY updated DESC")]
        if method == "create":
            title = str(args.get("title", "未命名设计")).strip()[:100] or "未命名设计"
            key, now = uuid.uuid4().hex, time.time()
            with self.db:
                self.db.execute("INSERT INTO projects (id,title,created,updated) VALUES(?,?,?,?)", (key, title, now, now))
            (self.root / key / "references").mkdir(parents=True)
            (self.root / key / "revisions").mkdir()
            return self.project(key)
        if method == "by_session":
            found = self.db.execute("SELECT id FROM projects WHERE session_id=?", (args["sessionId"],)).fetchone()
            if not found:
                raise ValueError("当前会话未绑定 MiniCAD 设计任务")
            return self.project(found["id"], False)
        key = str(args["projectId"])
        row = self.row(key)
        if method == "get":
            result = self.project(key, args.get("geometry", True))
            if result["design"] and args.get("geometry", True):
                state = result["design"]
                self.ensure_views(self.snapshot(key)[0], state)
                state["drawing"] = drawing_svg(state["views"], state["metrics"], row["title"], args.get("locale", "en"))
            return result
        if method == "model_selection":
            with self.db:
                self.db.execute("UPDATE projects SET model_selection=? WHERE id=?", (args["selection"], key))
            return {"saved": True}
        if method == "bind":
            if row["session_id"] and row["session_id"] != args["sessionId"]:
                raise Conflict("任务已绑定另一个会话")
            with self.db:
                self.db.execute("UPDATE projects SET session_id=? WHERE id=?", (args["sessionId"], key))
            return self.project(key, False)
        if method == "rename":
            title = str(args["title"]).strip()[:100]
            if not title:
                raise ValueError("请输入设计名称")
            with self.db:
                self.db.execute("UPDATE projects SET title=?,updated=? WHERE id=?", (title, time.time(), key))
            return self.project(key, False)
        if method == "message":
            with self.db:
                self.db.execute("INSERT OR IGNORE INTO messages VALUES(?,?,?,?,?)", (str(args["id"]), key, str(args["role"]), str(args["text"])[:100000], args.get("created", time.time())))
                self.db.execute("UPDATE projects SET updated=? WHERE id=?", (time.time(), key))
            return {"saved": True}
        if method == "attach":
            data = base64.b64decode(args["data"], validate=True)
            if len(data) > 20 * 1024 * 1024 or not data.startswith(b"%PDF-"):
                raise ValueError("请选择不超过 20 MB 的 PDF 文件")
            from pypdf import PdfReader
            pdf = PdfReader(io.BytesIO(data))
            if pdf.is_encrypted:
                raise ValueError("请先解密 PDF")
            aid = uuid.uuid4().hex
            name = re.split(r"[/\\]", str(args["name"]))[-1][:160]
            (self.directory(key) / "references" / (aid + ".pdf")).write_bytes(data)
            with self.db:
                self.db.execute("INSERT INTO attachments VALUES(?,?,?,?,?)", (aid, key, name, len(pdf.pages), len(data)))
            return self.project(key, False)
        if method in ("reference", "reference_file"):
            entry = self.db.execute("SELECT * FROM attachments WHERE id=? AND project_id=?", (args["attachmentId"], key)).fetchone()
            if entry is None:
                raise ValueError("参考文件不存在")
            path = self.directory(key) / "references" / (entry["id"] + ".pdf")
            if method == "reference_file":
                return {"name": entry["name"], "mediaType": "application/pdf", "data": base64.b64encode(path.read_bytes()).decode()}
            page = int(args.get("page", 1))
            if not 1 <= page <= entry["pages"]:
                raise ValueError("页码超出范围")
            from pypdf import PdfReader
            import pypdfium2 as pdfium
            with pdfium.PdfDocument(str(path)) as pdf:
                sheet = pdf[page - 1]
                try:
                    scale = min(2.0, 1800 / max(sheet.get_size()))
                    bitmap = sheet.render(scale=scale)
                    image = bitmap.to_pil()
                    buf = io.BytesIO()
                    image.save(buf, format="PNG")
                    bitmap.close()
                finally:
                    sheet.close()
            return {"name": entry["name"], "page": page, "pages": entry["pages"], "text": (PdfReader(path).pages[page - 1].extract_text() or "")[:30000], "image": base64.b64encode(buf.getvalue()).decode(), "mediaType": "image/png"}
        if method == "build":
            return self.build(key, args)
        if method == "restore":
            self.expect(row, args)
            saved = self.snapshot(key, args["revision"])
            revision = row["head"] + 1
            # The monotonically increasing head avoids stale UI/agent writes after undo.
            with self.db:
                self.db.execute("INSERT INTO revisions VALUES(?,?,?,?,?)", (key, revision, saved[0].name, str(args.get("summary", f"Restore v{args['revision']}"))[:200], time.time()))
                self.db.execute("UPDATE projects SET head=?,updated=? WHERE id=?", (revision, time.time(), key))
            return self.project(key)
        if method == "export":
            return self.export(key, args)
        raise ValueError("不支持的操作")

    @staticmethod
    def expect(row, args):
        if args.get("expectedRevision") != row["head"]:
            raise Conflict("设计已更新，请重新读取当前版本后再修改")

    def build(self, key, args):
        row = self.row(key)
        self.expect(row, args)
        previous = self.snapshot(key)
        old = previous[1] if previous else {}
        source = args.get("source", old.get("source", ""))
        parameters = args.get("parameters", old.get("parameters", {}))
        if not isinstance(source, str) or len(source) > 200000 or not source.strip():
            raise ValueError("需要定义 build(parameters) 函数的 Python 建模源码")
        if not isinstance(parameters, dict):
            raise ValueError("parameters 必须是 JSON 对象")
        json_text(parameters)
        from build123d import Shape, export_brep
        namespace = {"__name__": "minicad_model"}
        exec(compile(source, "model.py", "exec"), namespace)
        if not callable(namespace.get("build")):
            raise ValueError("model.py 必须定义 build(parameters) 函数")
        shape = namespace["build"](parameters)
        if not isinstance(shape, Shape) or not shape.is_valid or not shape.solids() or shape.volume <= 0:
            raise ValueError("模型必须包含有效的封闭实体；当前版本未被覆盖")
        bbox = shape.bounding_box()
        metrics = {"sizeX": bbox.size.X, "sizeY": bbox.size.Y, "sizeZ": bbox.size.Z, "volume": shape.volume, "solidCount": len(shape.solids()), "faceCount": len(shape.faces()), "valid": True}
        checks = []
        for check in args.get("checks", old.get("requirements", [])):
            metric = check["metric"]
            expected = dimension_expression(check["expression"], parameters) if check.get("expression") else float(check["expected"])
            tolerance = float(check.get("tolerance", 0.01))
            if metric not in metrics or metric == "valid" or not math.isfinite(expected) or not math.isfinite(tolerance) or tolerance < 0:
                raise ValueError("检查项或公差无效")
            actual = metrics[metric]
            checks.append({**check, "expected": expected, "actual": actual, "passed": abs(actual - expected) <= tolerance})
        if any(not c["passed"] for c in checks):
            raise ValueError("尺寸检查未通过：" + json_text(checks))
        vertices, triangles = shape.tessellate(max(max(bbox.size) * 0.0003, 0.01), 0.15)
        if len(triangles) > 500000:
            raise ValueError("预览网格超过 50 万三角形，请简化模型")
        edges = []
        for edge in shape.edges():
            try:
                count = 2 if str(edge.geom_type).endswith("LINE") else 33
                edges.append([list(edge.position_at(i / (count - 1))) for i in range(count)])
            except Exception:
                continue
        views = projection_views(shape)
        state = {"source": source, "parameters": parameters, "requirements": args.get("checks", old.get("requirements", [])), "checks": checks, "metrics": metrics, "mesh": {"vertices": [list(v) for v in vertices], "triangles": triangles}, "edges": edges, "drawing": drawing_svg(views, metrics, row["title"], args.get("locale", "en")), "views": views, "projectionVersion": 2}
        revision, stamp = row["head"] + 1, time.time()
        folder = self.directory(key) / "revisions" / uuid.uuid4().hex
        folder.mkdir()
        export_brep(shape, folder / "model.brep")
        (folder / "model.py").write_text(source, encoding="utf-8")
        (folder / "parameters.json").write_text(json_text(parameters), encoding="utf-8")
        (folder / "state.json").write_text(json_text(state), encoding="utf-8")
        self.expect(self.row(key), args)
        with self.db:
            self.db.execute("INSERT INTO revisions VALUES(?,?,?,?,?)", (key, revision, folder.name, str(args.get("summary", "更新设计"))[:200], stamp))
            self.db.execute("UPDATE projects SET head=?,updated=? WHERE id=?", (revision, stamp, key))
        return self.project(key, args.get("geometry", True))

    def export(self, key, args):
        saved = self.snapshot(key, args["revision"])
        if saved is None:
            raise ValueError("请先完成建模")
        folder, state = saved
        format = args["format"]
        if format in ("svg", "pdf"):
            self.ensure_views(folder, state)
        from build123d import import_brep, import_step, export_step, export_stl
        name = re.sub(r'[<>:"/\\|?*]', "_", self.row(key)["title"]) + f"-v{int(args['revision'])}"
        if format in ("step", "stl"):
            shape = import_brep(folder / "model.brep")
            target = folder / ("export." + format)
            if format == "step":
                export_step(shape, target)
                reread = import_step(target)
                if not reread.is_valid or abs(reread.volume - shape.volume) > max(0.001, shape.volume * 1e-6):
                    raise ValueError("STEP 回读校验失败")
            else:
                export_stl(shape, target)
            data, mime = target.read_bytes(), "application/octet-stream"
        elif format == "svg":
            data, mime = drawing_svg(state["views"], state["metrics"], self.row(key)["title"], args.get("locale", "en")).encode(), "image/svg+xml"
        elif format == "pdf":
            data, mime = drawing_pdf(state["views"], state["metrics"], self.row(key)["title"], args["revision"], args.get("locale", "en")), "application/pdf"
        elif format == "zip":
            output = io.BytesIO()
            with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
                for file in ("model.py", "parameters.json", "model.brep"):
                    archive.write(folder / file, file)
                archive.writestr("project.json", json_text({"title": self.row(key)["title"], "revision": args["revision"], "unit": "mm", "kernel": "build123d 0.10.0", "requirements": state["requirements"], "checks": state["checks"]}))
            data, mime = output.getvalue(), "application/zip"
        else:
            raise ValueError("不支持的导出格式")
        return {"name": name + "." + format, "mediaType": mime, "data": base64.b64encode(data).decode(), "revision": args["revision"]}


def projection_views(shape):
    views = []
    for name, direction, up in [("TOP", (0, 0, 1), (0, 1, 0)), ("FRONT", (0, -1, 0), (0, 0, 1)), ("RIGHT", (1, 0, 0), (0, 0, 1))]:
        # viewport_origin is a position, not a direction. Pin look_at explicitly
        # so translating a part never rotates the orthographic camera.
        visible, hidden = shape.project_to_viewport(direction, viewport_up=up, look_at=(0, 0, 0))
        paths = []
        for dashed, group in [(False, visible), (True, hidden)]:
            for edge in group:
                count = 2 if str(edge.geom_type).endswith("LINE") else 49
                points = [list(edge.position_at(i / (count - 1)))[:2] for i in range(count)]
                paths.append({"hidden": dashed, "points": points})
        views.append({"name": name, "paths": paths})
    return views


def view_bounds(view):
    points = [p for path in view["paths"] for p in path["points"]]
    lo = [min(p[a] for p in points) for a in (0, 1)]
    hi = [max(p[a] for p in points) for a in (0, 1)]
    return lo, hi


def drawing_scale(views):
    bounds = [view_bounds(view) for view in views]
    return min(360 / max(max(hi[0] - lo[0] for lo, hi in bounds), 1), 170 / max(max(hi[1] - lo[1] for lo, hi in bounds), 1))


def fit_view(view, x, y, width, height, scale):
    lo, hi = view_bounds(view)
    return lambda p: (x + width / 2 + (p[0] - (lo[0] + hi[0]) / 2) * scale, y + height / 2 - (p[1] - (lo[1] + hi[1]) / 2) * scale)


def drawing_svg(views, metrics, title, locale="en"):
    out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 600"><rect width="900" height="600" fill="white"/>', f'<text x="40" y="42" font-family="sans-serif" font-size="18" fill="#353638">{escape(title)}</text>']
    for i, view in enumerate(views):
        x, y = [(55, 85), (55, 320), (480, 320)][i]
        fit = fit_view(view, x, y, 360, 170, drawing_scale(views))
        for path in sorted(view["paths"], key=lambda p: not p["hidden"]):
            points = " ".join(f"{a:.3f},{b:.3f}" for a, b in map(fit, path["points"]))
            dash = ' stroke-dasharray="4 3"' if path["hidden"] else ""
            out.append(f'<polyline points="{points}" fill="none" stroke="{ "#adb2b8" if path["hidden"] else "#353638"}" stroke-width="1"{dash}/>')
        label = {"TOP": "俯视", "FRONT": "前视", "RIGHT": "右视"}[view["name"]] if locale == "zh" else view["name"]
        out.append(f'<text x="{x + 180}" y="{y + 195}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#61666b">{label}</text>')
    dims = " × ".join(f'{metrics[k]:.3f}' for k in ("sizeX", "sizeY", "sizeZ"))
    note = "正投影视图 · 仅含外形尺寸" if locale == "zh" else "Orthographic views · Overall dimensions only"
    out.append(f'<path d="M40 548H860" stroke="#e1e5ee"/><text x="40" y="575" font-family="sans-serif" font-size="12" fill="#61666b">{dims} mm · {note}</text></svg>')
    return "".join(out)


def drawing_pdf(views, metrics, title, revision, locale="en"):
    from reportlab.pdfgen import canvas
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(900, 600))
    c.setTitle(f"{title} v{revision}")
    c.setFont("STSong-Light", 18)
    c.drawString(40, 558, f"{title}  ·  v{revision}")
    for i, view in enumerate(views):
        x, y = [(55, 85), (55, 320), (480, 320)][i]
        fit = fit_view(view, x, y, 360, 170, drawing_scale(views))
        for item in sorted(view["paths"], key=lambda p: not p["hidden"]):
            c.setDash(4, 3) if item["hidden"] else c.setDash()
            c.setStrokeGray(0.65 if item["hidden"] else 0.2)
            path = c.beginPath()
            for j, p in enumerate(item["points"]):
                a, b = fit(p)
                (path.moveTo if j == 0 else path.lineTo)(a, 600 - b)
            c.drawPath(path)
        c.setFont("STSong-Light" if locale == "zh" else "Helvetica", 12)
        label = {"TOP": "俯视", "FRONT": "前视", "RIGHT": "右视"}[view["name"]] if locale == "zh" else view["name"]
        c.drawCentredString(x + 180, 600 - y - 195, label)
    c.setFont("STSong-Light", 12)
    dims = " × ".join(f'{metrics[k]:.3f}' for k in ("sizeX", "sizeY", "sizeZ"))
    note = f"外形尺寸：{dims} mm  |  正投影视图（不含公差、表面处理及完整制造标注）" if locale == "zh" else f"Overall size: {dims} mm | Orthographic views; not a fully dimensioned manufacturing drawing."
    c.drawString(40, 25, note)
    c.save()
    return buf.getvalue()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", required=True)
    store = Store(parser.parse_args().data_dir)
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            with contextlib.redirect_stdout(sys.stderr):
                result = store.dispatch(request["method"], request.get("params", {}))
            response = {"id": request["id"], "result": result}
        except Exception as error:
            response = {"id": request.get("id"), "error": str(error), "status": 409 if isinstance(error, Conflict) else 400}
            traceback.print_exc(file=sys.stderr)
        sys.stdout.write(json_text(response) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
