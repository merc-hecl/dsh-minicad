"""JSON-lines modeling service using ordinary project files and local snapshots."""
import argparse
import base64
import contextlib
from copy import deepcopy
import hashlib
import io
import json
import os
from pathlib import Path
import re
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


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2) + "\n").encode("utf-8")


def atomic_write(path, data):
    path = Path(path)
    if data is None:
        path.unlink(missing_ok=True)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("xb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def inside(root, relative):
    target = (root / relative).resolve()
    if not target.is_relative_to(root) or target == root:
        raise ValueError("项目文件路径超出工作目录")
    return target


def model_path(root, name):
    if not isinstance(name, str) or Path(name).is_absolute() or Path(name).suffix != ".py" or Path(name).parts[0].startswith("."):
        raise ValueError("建模文件必须是工作目录内的 Python 文件")
    return inside(root, name)


def working_paths(root, name):
    source = model_path(root, name)
    return (source, source.with_suffix(".parameters.json"), source.with_suffix(".brep"))


def file_bytes(path):
    return path.read_bytes() if path.exists() else None


def task_root(root, task):
    return inside(root, task["directory"])


def available_directory(root, title):
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", title).strip(" .")[:80] or "design"
    if name.split(".")[0].upper() in {"CON", "PRN", "AUX", "NUL", *[f"{prefix}{n}" for prefix in ("COM", "LPT") for n in range(1, 10)]}:
        name = "_" + name
    target, number = inside(root, name), 2
    while target.exists():
        target = inside(root, f"{name}-{number}")
        number += 1
    return target


@contextlib.contextmanager
def model_environment(root):
    cwd, modules = Path.cwd(), set(sys.modules)
    sys.path.insert(0, str(root))
    os.chdir(root)
    try:
        yield
    finally:
        os.chdir(cwd)
        sys.path.remove(str(root))
        for name in set(sys.modules) - modules:
            location = getattr(sys.modules[name], "__file__", None)
            if location and Path(location).resolve().is_relative_to(root):
                sys.modules.pop(name, None)


class Store:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.registry = self.root / "libraries.json"
        self.journal = self.root / "pending-files.json"
        self.recover()
        if not self.registry.exists():
            if list(self.root.glob("*.sqlite3")):
                raise ValueError("已有设计数据尚未迁移为项目文件，请先完成数据迁移")
            atomic_write(self.registry, json_bytes({"version": 1, "paths": []}))
            default = self.root / "default"
            default.mkdir(exist_ok=True)
            self.open_library(default, "")

    def recover(self):
        if not self.journal.exists():
            return
        pending = json.loads(self.journal.read_text(encoding="utf-8"))
        if pending["phase"] != "committed":
            for change in reversed(pending["files"]):
                before = change["before"]
                atomic_write(Path(change["path"]), base64.b64decode(before) if before is not None else None)
        self.journal.unlink()

    def commit(self, changes):
        self.recover()
        pending = {"phase": "prepared", "files": [
            {"path": str(path), "before": base64.b64encode(before).decode() if (before := file_bytes(path)) is not None else None}
            for path in changes
        ]}
        atomic_write(self.journal, json_bytes(pending))
        try:
            for path, value in changes.items():
                atomic_write(path, value)
            pending["phase"] = "committed"
            atomic_write(self.journal, json_bytes(pending))
        except Exception:
            self.recover()
            raise
        self.journal.unlink()

    def paths(self):
        self.recover()
        return [Path(path).resolve() for path in json.loads(self.registry.read_text(encoding="utf-8"))["paths"]]

    @staticmethod
    def read_workspace(root):
        data = json.loads((root / "minicad.json").read_text(encoding="utf-8"))
        if data.get("version") != 2 or not isinstance(data.get("projects"), dict):
            raise ValueError("设计库元数据无效")
        return data

    def workspaces(self):
        return [(path, self.read_workspace(path)) for path in self.paths() if path.is_dir()]

    def find_library(self, library_id):
        for root, data in self.workspaces():
            if data["id"] == library_id:
                return root, data
        raise ValueError("设计库不存在")

    @staticmethod
    def library_info(root, data):
        return {"id": data["id"], "title": data["title"], "path": str(root), "created": data["created"], "updated": data["updated"]}

    def library(self, library_id):
        return self.library_info(*self.find_library(library_id))

    def locate(self, project_id):
        for root, data in self.workspaces():
            if project_id in data["projects"]:
                return root, data, data["projects"][project_id]
        raise ValueError("设计任务不存在")

    @staticmethod
    def project_row(root, data, task):
        model = task["models"].get(task["sourceFile"], {})
        return {"id": task["id"], "title": task["title"], "library_id": data["id"], "session_id": task.get("session_id"),
                "head": model.get("head", 0), "created": task["created"], "updated": max(task["updated"], model.get("updated", 0)),
                "directory": str(task_root(root, task)), "sourceFile": task["sourceFile"], "has_messages": bool(task.get("started"))}

    def row(self, project_id):
        return self.project_row(*self.locate(project_id))

    def directory(self, project_id):
        root, _, task = self.locate(project_id)
        return task_root(root, task)

    def save_workspace(self, root, data):
        data["updated"] = time.time()
        atomic_write(root / "minicad.json", json_bytes(data))

    def snapshot(self, project_id, revision=None):
        root, data, task = self.locate(project_id)
        model = task["models"].get(task["sourceFile"], {})
        revision = model.get("head", 0) if revision is None else int(revision)
        if not revision:
            return None
        entry = next((entry for entry in model["revisions"] if entry["revision"] == revision), None)
        if entry is None:
            raise ValueError("版本不存在")
        folder = inside(task_root(root, task), entry["folder"])
        return folder, json.loads((folder / "state.json").read_text(encoding="utf-8"))

    @staticmethod
    def ensure_views(folder, state):
        if state.get("projectionVersion") != 2:
            from build123d import import_brep
            state["views"] = projection_views(import_brep(folder / "model.brep"))
            state["projectionVersion"] = 2
        return state

    def project(self, project_id, geometry=True):
        root, data, task = self.locate(project_id)
        result = self.project_row(root, data, task)
        directory = task_root(root, task)
        result["workspaceDirectory"] = str(directory)
        result["modelSelection"] = task.get("model_selection", "")
        result["models"] = [{"sourceFile": name, "head": model["head"]} for name, model in task["models"].items()]
        saved = self.snapshot(project_id)
        state = saved[1] if saved else None
        source, parameters, brep = working_paths(directory, task["sourceFile"])
        source_data, parameter_data = file_bytes(source), file_bytes(parameters)
        result["source"] = source_data.decode("utf-8") if source_data is not None else (state or {}).get("source", "")
        try:
            result["parameters"] = json.loads(parameter_data) if parameter_data is not None else (state or {}).get("parameters", {})
            if not isinstance(result["parameters"], dict):
                raise ValueError()
        except (ValueError, UnicodeError):
            result["parameters"] = None
            result["workingError"] = "parameters 必须是 JSON 对象"
        result["sourceVersion"] = hashlib.sha256((source_data or b"") + b"\0" + (parameter_data or b"")).hexdigest()
        result["workingTreeChanged"] = bool(state and (result["source"] != state["source"] or result["parameters"] != state["parameters"]))
        if state:
            state["source"] = result["source"]
            if result["parameters"] is not None:
                state["parameters"] = result["parameters"]
        result["design"] = state
        if state and not geometry:
            result["design"] = {key: value for key, value in state.items() if key not in ("mesh", "edges", "drawing", "views")}
        result["revisions"] = sorted(task["models"].get(task["sourceFile"], {}).get("revisions", []), key=lambda entry: -entry["revision"])
        result["attachments"] = [{key: value for key, value in entry.items() if key != "path"} for entry in task.get("attachments", [])]
        result["messages"] = task.get("messages", [])
        return result

    def open_library(self, path, title=None):
        if not path.is_absolute():
            raise ValueError("请选择设计库文件夹")
        try:
            root = path.resolve(strict=True)
        except OSError:
            raise ValueError("设计库文件夹不存在或无法访问") from None
        if not root.is_dir():
            raise ValueError("设计库文件夹不存在或无法访问")
        paths = self.paths()
        for registered in paths:
            if registered == root:
                return self.library_info(root, self.read_workspace(root))
        now = time.time()
        data = self.read_workspace(root) if (root / "minicad.json").exists() else {
            "version": 2, "id": uuid.uuid4().hex, "title": (root.name or str(root)) if title is None else title,
            "created": now, "updated": now, "projects": {}}
        if any(other["id"] == data["id"] for _, other in self.workspaces()):
            # A copied project retains its model history, but gets new conversation bindings.
            data["id"] = uuid.uuid4().hex
            data["projects"] = {new_id: {**task, "id": new_id, "session_id": None}
                                for task in data["projects"].values() for new_id in [uuid.uuid4().hex]}
        self.commit({root / "minicad.json": json_bytes(data), self.registry: json_bytes({"version": 1, "paths": [str(path) for path in paths] + [str(root)]})})
        return self.library_info(root, data)

    def record_revision(self, key, source_file, state, folder, summary, expected, inputs=None):
        root, data, task = self.locate(key)
        directory = task_root(root, task)
        model = task["models"].setdefault(source_file, {"head": 0, "revisions": []})
        if model["head"] != expected:
            raise Conflict("设计已更新，请重新读取当前版本后再修改")
        if inputs and any(file_bytes(path) != value for path, value in inputs.items()):
            raise Conflict("设计已更新，请重新读取当前版本后再修改")
        revision, now = expected + 1, time.time()
        model["head"], model["updated"] = revision, now
        model["revisions"].append({"revision": revision, "folder": folder.relative_to(directory).as_posix(), "summary": str(summary)[:200], "created": now})
        task["sourceFile"], task["started"], task["updated"] = source_file, True, now
        data["updated"] = now
        source, parameters, brep = working_paths(directory, source_file)
        self.commit({source: state["source"].encode("utf-8"), parameters: json_bytes(state["parameters"]), brep: (folder / "model.brep").read_bytes(), root / "minicad.json": json_bytes(data)})

    def dispatch(self, method, args):
        if method == "health":
            from importlib.metadata import version
            return {"ready": True, "kernel": "build123d " + version("build123d"), "python": sys.version.split()[0]}
        if method == "list":
            return sorted([self.project_row(root, data, task) for root, data in self.workspaces() for task in data["projects"].values()], key=lambda row: -row["updated"])
        if method == "libraries":
            return [self.library_info(root, data) for root, data in self.workspaces()]
        if method == "create_library":
            raw = args.get("path")
            if not isinstance(raw, str) or not raw.strip():
                raise ValueError("请选择设计库文件夹")
            return self.open_library(Path(raw))
        if method == "rename_library":
            root, data = self.find_library(args["libraryId"])
            title = str(args.get("title", "")).strip()[:100]
            if not title:
                raise ValueError("请输入设计库名称")
            data["title"] = title
            self.save_workspace(root, data)
            return self.library_info(root, data)
        if method == "remove_library":
            root, _ = self.find_library(args["libraryId"])
            self.commit({self.registry: json_bytes({"version": 1, "paths": [str(path) for path in self.paths() if path != root]})})
            return {"removed": True}
        if method == "create":
            libraries = self.dispatch("libraries", {})
            library_id = args.get("libraryId", libraries[0]["id"])
            root, data = self.find_library(library_id)
            key, now = uuid.uuid4().hex, time.time()
            title = str(args.get("title", "未命名设计")).strip()[:100] or "未命名设计"
            directory = available_directory(root, title)
            source_file = model_path(directory, args.get("sourceFile", "model.py")).relative_to(directory).as_posix()
            directory.mkdir()
            data["projects"][key] = {"id": key, "title": title, "directory": directory.name, "models": {},
                "session_id": None, "sourceFile": source_file, "created": now, "updated": now, "started": False, "attachments": []}
            self.save_workspace(root, data)
            return self.project(key)
        if method == "by_session":
            for root, data in self.workspaces():
                for task in data["projects"].values():
                    if task.get("session_id") == args["sessionId"]:
                        return self.project(task["id"], False)
            raise ValueError("当前会话未绑定 MiniCAD 设计任务")
        if method == "discard_empty":
            for root, data in self.workspaces():
                task = data["projects"].get(str(args["projectId"]))
                if task is None:
                    continue
                if task.get("started") or task["models"] or task.get("attachments") or task.get("messages"):
                    return {"discarded": False}
                directory = task_root(root, task)
                try:
                    directory.rmdir()  # Never recursively remove files created by an external editor.
                except FileNotFoundError:
                    pass
                except OSError:
                    return {"discarded": False}
                del data["projects"][task["id"]]
                try:
                    self.save_workspace(root, data)
                except Exception:
                    directory.mkdir(exist_ok=True)
                    raise
                return {"discarded": True}
            return {"discarded": False}
        key = str(args["projectId"])
        root, data, task = self.locate(key)
        directory = task_root(root, task)
        row = self.project_row(root, data, task)
        if method == "fork_project":
            session_id = str(args["sessionId"])
            if any(other.get("session_id") == session_id for _, doc in self.workspaces() for other in doc["projects"].values()):
                raise Conflict("任务已绑定另一个会话")
            title = str(args.get("title") or task["title"])[:100]
            target = available_directory(root, title)
            entries = list(directory.rglob("*"))
            if any(path.is_symlink() for path in entries):
                raise ValueError("任务目录无法安全迁移")
            changes = {target / path.relative_to(directory): path.read_bytes() for path in entries if path.is_file()}
            target.mkdir()
            for path in entries:
                if path.is_dir():
                    (target / path.relative_to(directory)).mkdir(parents=True, exist_ok=True)
            branch = deepcopy(task)
            branch_id, now = uuid.uuid4().hex, time.time()
            branch.update(id=branch_id, title=title, session_id=session_id, directory=target.name, created=now, updated=now)
            data["projects"][branch_id] = branch
            data["updated"] = now
            changes[root / "minicad.json"] = json_bytes(data)
            self.commit(changes)
            return self.project(branch_id)
        if method == "get":
            result = self.project(key, args.get("geometry", True))
            if result["design"] and args.get("geometry", True):
                state = result["design"]
                self.ensure_views(self.snapshot(key)[0], state)
                state["drawing"] = drawing_svg(state["views"], state["metrics"], task["title"], args.get("locale", "en"))
            return result
        if method == "select_model":
            task["sourceFile"] = model_path(directory, args["sourceFile"]).relative_to(directory).as_posix()
            self.save_workspace(root, data)
            return self.project(key, args.get("geometry", False))
        if method == "model_selection":
            task["model_selection"] = args["selection"]
        elif method == "bind":
            if task.get("session_id") and task["session_id"] != args["sessionId"]:
                raise Conflict("任务已绑定另一个会话")
            if any(other.get("session_id") == args["sessionId"] and other["id"] != key for _, doc in self.workspaces() for other in doc["projects"].values()):
                raise Conflict("任务已绑定另一个会话")
            task["session_id"] = args["sessionId"]
        elif method == "rename":
            title = str(args["title"]).strip()[:100]
            if not title:
                raise ValueError("请输入设计名称")
            task["title"] = title
        elif method == "message":
            task["started"] = task.get("started", False) or args["role"] == "user"
        elif method == "move_project":
            destination, other = self.find_library(args["libraryId"])
            if destination == root:
                return self.project(key, False)
            if key in other["projects"]:
                raise ValueError("目标任务已存在")
            target = available_directory(destination, directory.name)
            if target.is_relative_to(directory) or directory.is_relative_to(target):
                raise ValueError("任务目录无法安全迁移")
            entries = list(directory.rglob("*"))
            if any(path.is_symlink() for path in entries):
                raise ValueError("任务目录无法安全迁移")
            files = [path for path in entries if path.is_file()]
            changes = {target / path.relative_to(directory): path.read_bytes() for path in files}
            # Preserve empty resource directories as well as ordinary user files.
            target.mkdir()
            for path in entries:
                if path.is_dir():
                    (target / path.relative_to(directory)).mkdir(parents=True, exist_ok=True)
            other["projects"][key] = {**task, "directory": target.name}
            del data["projects"][key]
            data["updated"] = other["updated"] = time.time()
            changes.update({root / "minicad.json": json_bytes(data), destination / "minicad.json": json_bytes(other)})
            changes.update({path: None for path in files})
            self.commit(changes)
            for path in sorted([path for path in entries if path.is_dir()], key=lambda path: len(path.parts), reverse=True) + [directory]:
                try:
                    path.rmdir()
                except OSError:
                    pass  # Keep files added by an external editor during the move.
            return self.project(key, False)
        elif method == "attach":
            content = base64.b64decode(args["data"], validate=True)
            if len(content) > 20 * 1024 * 1024 or not content.startswith(b"%PDF-"):
                raise ValueError("请选择不超过 20 MB 的 PDF 文件")
            from pypdf import PdfReader
            pdf = PdfReader(io.BytesIO(content))
            if pdf.is_encrypted:
                raise ValueError("请先解密 PDF")
            name = re.split(r"[/\\]", str(args["name"]))[-1][:160]
            name = re.sub(r'[<>:"/\\|?*]', "_", name).strip(" .") or "reference.pdf"
            original = inside(directory, "references/" + name)
            target, number = original, 2
            while target.exists() and target.read_bytes() != content:
                target = original.with_name(f"{original.stem}_{number}{original.suffix}")
                number += 1
            aid = uuid.uuid4().hex
            task.setdefault("attachments", []).append({"id": aid, "name": name, "pages": len(pdf.pages), "bytes": len(content), "path": target.relative_to(directory).as_posix()})
            self.commit({target: content, root / "minicad.json": json_bytes(data)})
            return self.project(key, False)
        elif method in ("reference", "reference_file"):
            entry = next((item for item in task.get("attachments", []) if item["id"] == args["attachmentId"]), None)
            if entry is None:
                raise ValueError("参考文件不存在")
            path = inside(directory, entry["path"])
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
                    bitmap = sheet.render(scale=min(2.0, 1800 / max(sheet.get_size())))
                    image = bitmap.to_pil()
                    buf = io.BytesIO()
                    image.save(buf, format="PNG")
                    bitmap.close()
                finally:
                    sheet.close()
            return {"name": entry["name"], "page": page, "pages": entry["pages"], "text": (PdfReader(path).pages[page - 1].extract_text() or "")[:30000], "image": base64.b64encode(buf.getvalue()).decode(), "mediaType": "image/png"}
        elif method == "build":
            return self.build(key, args)
        elif method == "restore":
            self.expect(row, args)
            folder, state = self.snapshot(key, args["revision"])
            self.record_revision(key, task["sourceFile"], state, folder, args.get("summary", f"Restore v{args['revision']}"), row["head"])
            return self.project(key)
        elif method == "export":
            return self.export(key, args)
        else:
            raise ValueError("不支持的操作")
        task["updated"] = time.time()
        self.save_workspace(root, data)
        return {"saved": True} if method in ("message", "model_selection") else self.project(key, False)

    @staticmethod
    def expect(row, args):
        if args.get("expectedRevision") != row["head"]:
            raise Conflict("设计已更新，请重新读取当前版本后再修改")


    def build(self, key, args):
        root, data, task = self.locate(key)
        root = task_root(root, task)
        source_file = model_path(root, args.get("sourceFile", task["sourceFile"])).relative_to(root).as_posix()
        head = task["models"].get(source_file, {}).get("head", 0)
        self.expect({"head": head}, args)
        source_path, parameter_path, brep_path = working_paths(root, source_file)
        inputs = {path: file_bytes(path) for path in (source_path, parameter_path, brep_path)}
        source = args.get("source", (inputs[source_path] or b"").decode("utf-8"))
        try:
            parameters = args["parameters"] if "parameters" in args else json.loads(inputs[parameter_path] or b"{}")
        except (ValueError, UnicodeError):
            raise ValueError("parameters 必须是 JSON 对象") from None
        if not isinstance(source, str) or len(source) > 200000 or not source.strip():
            raise ValueError("需要定义 build(parameters) 函数的 Python 建模源码")
        if not isinstance(parameters, dict):
            raise ValueError("parameters 必须是 JSON 对象")
        json_text(parameters)
        from build123d import Shape, export_brep
        namespace = {"__name__": "minicad_model", "__file__": str(source_path)}
        with model_environment(root):
            exec(compile(source, str(source_path), "exec"), namespace)
            if not callable(namespace.get("build")):
                raise ValueError("model.py 必须定义 build(parameters) 函数")
            shape = namespace["build"](parameters)
        if not isinstance(shape, Shape) or not shape.is_valid or not shape.solids() or shape.volume <= 0:
            raise ValueError("模型必须包含有效的封闭实体；当前版本未被覆盖")
        bbox = shape.bounding_box()
        metrics = {"sizeX": bbox.size.X, "sizeY": bbox.size.Y, "sizeZ": bbox.size.Z, "volume": shape.volume, "solidCount": len(shape.solids()), "faceCount": len(shape.faces()), "valid": True}
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
        state = {"source": source, "parameters": parameters, "metrics": metrics, "mesh": {"vertices": [list(v) for v in vertices], "triangles": triangles}, "edges": edges, "drawing": drawing_svg(views, metrics, task["title"], args.get("locale", "en")), "views": views, "projectionVersion": 2}
        history = inside(root, ".cad-history/" + Path(source_file).with_suffix("").as_posix())
        folder, number = history / f"v{head + 1:04d}", 2
        while folder.exists():
            folder = history / f"v{head + 1:04d}-{number}"
            number += 1
        folder.mkdir(parents=True)
        export_brep(shape, folder / "model.brep")
        atomic_write(folder / "model.py", source.encode("utf-8"))
        atomic_write(folder / "parameters.json", json_bytes(parameters))
        atomic_write(folder / "state.json", json_bytes(state))
        self.record_revision(key, source_file, state, folder, args.get("summary", "更新设计"), head, inputs)
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
            source_file = self.row(key)["sourceFile"]
            stem = str(Path(source_file).with_suffix(""))
            with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
                for file, name_in_zip in (("model.py", source_file), ("parameters.json", stem + ".parameters.json"), ("model.brep", stem + ".brep")):
                    archive.write(folder / file, name_in_zip)
                archive.writestr("project.json", json_text({"title": self.row(key)["title"], "revision": args["revision"], "unit": "mm", "kernel": "build123d 0.10.0"}))
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
