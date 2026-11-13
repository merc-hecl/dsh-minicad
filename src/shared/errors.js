// The diagnostic message is used by logs and tools. The workbench renders a single locale.
export function localizedError(zh, en, suffix = "") {
  return Object.assign(new Error(`${zh} / ${en}${suffix}`), {
    localized: { zh: zh + suffix, en: en + suffix },
  });
}

export function errorDetail(error) {
  return error.localized ?? error.message ?? String(error);
}

export function appendErrorDetail(error, zh, en, suffix) {
  const detail = errorDetail(error);
  error.localized = {
    zh: `${detail.zh ?? detail}\n${zh}${suffix}`,
    en: `${detail.en ?? detail}\n${en}${suffix}`,
  };
  error.message += `\n${zh} / ${en}${suffix}`;
}

// Stable translation keys for error summaries.
const rules = [
  ["freecadUnavailable", /未检测到 FreeCAD/],
  ["modelAppLaunchFailed", /FreeCAD 启动失败/],
  ["revisionConflict", /设计已更新/],
  ["parameterPanelChanged", /参数面板已更新/],
  ["workingFilesChanged", /模型工作文件已修改/],
  ["geometryReferenceInvalid", /几何引用已过期|几何引用不存在/],
  ["geometrySelectionMissing", /没有找到匹配的面或边/],
  ["geometrySelectionAmbiguous", /几何选择不唯一/],
  ["projectMissing", /设计任务不存在/],
  ["designFolderRequired", /请选择设计工作文件夹/],
  ["designFolderInvalid", /设计工作文件夹不存在/],
  ["saveAsEmpty", /另存为需要一个空文件夹/],
  ["taskMoveInvalid", /任务目录无法安全迁移/],
  ["workspacePathInvalid", /项目文件路径超出工作目录|模型文件必须是工作目录内的 SMP 文件/],
  ["workspaceMetadataInvalid", /设计元数据无效|设计元数据冲突/],
  ["invalidSolid", /封闭实体/],
  ["pdfOnly", /20 MB|PDF 文件/],
  ["revisionMissing", /版本不存在/],
  ["referenceMissing", /参考文件不存在/],
  ["projectUnbound", /未绑定 MiniCAD/],
  ["projectBound", /已绑定另一个/],
  ["nameRequired", /请输入设计名称/],
  ["sourceRequired", /定义 build\(parameters(?:, cad)?\)/],
  ["invalidJSON", /parameters 必须/],
  ["meshLimit", /50 万三角形/],
  ["noModel", /请先完成建模/],
  ["stepFailed", /STEP 回读/],
  ["unavailable", /不支持的|插件已卸载|MiniCAD 已关闭/],
  ["workerStopped", /服务已退出|操作已取消/],
  ["setupRequired", /无法启动建模服务/],
  ["buildBusy", /正在构建/],
  ["requestLarge", /请求过大/],
  ["modelCredentials", /no API key|API_KEY|unauthorized|401/i],
];
export function errorKey(message) {
  return rules.find(([, regex]) => regex.test(message))?.[0] || "error";
}
