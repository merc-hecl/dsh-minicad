// Adapted from DeepSeek Harness 0.2.1-rc.5 ui-workspace/src/client/rows/Rows.js.
// Copyright DeepSeek. MIT; see docs/licenses/dsh-workspace-MIT.txt.
// Library/task row presentation, scoped styles and navigation labels.
import * as react from "react";
import * as react_jsx_runtime from "react/jsx-runtime";
import * as _deepseek_ai_dsh_client_ui_primitives from "@deepseek-ai/dsh-client-ui-primitives";
const clsx = (...names) => names.filter(Boolean).join(" ");
const Rows_module_css_default = {
  "archived": "mc-design-row-archived",
  "arrow": "mc-design-row-arrow",
  "arrowOpen": "mc-design-row-arrowOpen",
  "chevron": "mc-design-row-chevron",
  "dot": "mc-design-row-dot",
  "dropAfter": "mc-design-row-dropAfter",
  "dropBefore": "mc-design-row-dropBefore",
  "folder": "mc-design-row-folder",
  "folderActive": "mc-design-row-folderActive",
  "hoverArchived": "mc-design-row-hoverArchived",
  "hoverContent": "mc-design-row-hoverContent",
  "hoverPath": "mc-design-row-hoverPath",
  "hoverStatus": "mc-design-row-hoverStatus",
  "hoverTime": "mc-design-row-hoverTime",
  "hoverTitle": "mc-design-row-hoverTitle",
  "iconButton": "mc-design-row-iconButton",
  "menuOpen": "mc-design-row-menuOpen",
  "meta": "mc-design-row-meta",
  "pinIndicator": "mc-design-row-pinIndicator",
  "projectRow": "mc-design-row-projectRow",
  "projectText": "mc-design-row-projectText",
  "renameInput": "mc-design-row-renameInput",
  "rowActions": "mc-design-row-rowActions",
  "searchResultHeading": "mc-design-row-searchResultHeading",
  "searchResultMeta": "mc-design-row-searchResultMeta",
  "searchResultRow": "mc-design-row-searchResultRow",
  "searchResultSnippet": "mc-design-row-searchResultSnippet",
  "searchResultTitle": "mc-design-row-searchResultTitle",
  "searchResultWorkspace": "mc-design-row-searchResultWorkspace",
  "selected": "mc-design-row-selected",
  "sessionRow": "mc-design-row-sessionRow",
  "slot": "mc-design-row-slot",
  "time": "mc-design-row-time",
  "title": "mc-design-row-title",
  "visuallyHidden": "mc-design-row-visuallyHidden"
};
export const workspaceClasses = {
  "archiveActivity": "mc-design-navigator-archiveActivity",
  "clearButton": "mc-design-navigator-clearButton",
  "deleteAction": "mc-design-navigator-deleteAction",
  "deleteStatus": "mc-design-navigator-deleteStatus",
  "empty": "mc-design-navigator-empty",
  "emptyAction": "mc-design-navigator-emptyAction",
  "emptyState": "mc-design-navigator-emptyState",
  "fade": "mc-design-navigator-fade",
  "flatList": "mc-design-navigator-flatList",
  "groupSection": "mc-design-navigator-groupSection",
  "headerActions": "mc-design-navigator-headerActions",
  "headerActionsHidden": "mc-design-navigator-headerActionsHidden",
  "iconButton": "mc-design-navigator-iconButton",
  "list": "mc-design-navigator-list",
  "listArea": "mc-design-navigator-listArea",
  "listTopDropActive": "mc-design-navigator-listTopDropActive",
  "listTopDropIndicator": "mc-design-navigator-listTopDropIndicator",
  "rail": "mc-design-navigator-rail",
  "renameError": "mc-design-navigator-renameError",
  "renameInput": "mc-design-navigator-renameInput",
  "root": "mc-design-navigator-root",
  "search": "mc-design-navigator-search",
  "search-skeleton": "mc-design-navigator-search-skeleton",
  "searchButton": "mc-design-navigator-searchButton",
  "searchExpanded": "mc-design-navigator-searchExpanded",
  "searchInput": "mc-design-navigator-searchInput",
  "searchSlot": "mc-design-navigator-searchSlot",
  "searchSlotExpanded": "mc-design-navigator-searchSlotExpanded",
  "searchStatus": "mc-design-navigator-searchStatus",
  "searchTree": "mc-design-navigator-searchTree",
  "sectionHeader": "mc-design-navigator-sectionHeader",
  "sectionLabel": "mc-design-navigator-sectionLabel",
  "sectionLabelHidden": "mc-design-navigator-sectionLabelHidden",
  "sessionOverflowButton": "mc-design-navigator-sessionOverflowButton",
  "skeletonBar": "mc-design-navigator-skeletonBar",
  "skeletonBarWide": "mc-design-navigator-skeletonBarWide",
  "skeletonBars": "mc-design-navigator-skeletonBars",
  "skeletonDot": "mc-design-navigator-skeletonDot",
  "skeletonRow": "mc-design-navigator-skeletonRow",
  "treeBody": "mc-design-navigator-treeBody",
  "viewOptionsMenu": "mc-design-navigator-viewOptionsMenu",
  "wide": "mc-design-navigator-wide",
  "wide-in": "mc-design-navigator-wide-in",
  "workspaceDropAfter": "mc-design-navigator-workspaceDropAfter",
  "workspaceDropBefore": "mc-design-navigator-workspaceDropBefore"
};
export const workspaceLocale = {
  "zh": {
    "defaultWorkspace.failed": "无法创建默认工作区，请通过“选择工作区”选择文件夹",
    "draft.workspaceRequired": "请先选择工作区",
    "draft.initializationFailed": "暂时无法填入草稿，请稍后重试",
    "group.ungrouped": "未分组",
    "session.new": "新会话",
    "session.untitled": "未命名",
    "shortcut.noSession": "请先选择一个会话",
    "shortcut.noPicker": "目录选择器不可用",
    "shortcut.directoryBusy": "正在选择或添加工作区",
    "shortcut.noCompletedTurn": "当前会话没有已结束的轮次",
    "shortcut.forkFailed": "无法分叉会话，请重试",
    "section.workspaces": "工作区",
    "section.sessions": "会话",
    "viewOptions.label": "视图选项",
    "groupBy.label": "分组方式",
    "groupBy.workspace": "按工作区",
    "groupBy.workspaceTree": "按工作区树",
    "groupBy.flat": "单列表",
    "orderBy.label": "排序方式",
    "orderBy.manual": "手动排序",
    "orderBy.updated": "最近更新",
    "filterBy.label": "筛选会话",
    "viewOptions.hideArchived": "隐藏已归档",
    "viewOptions.showArchived": "全部对话（显示已归档）",
    "viewOptions.onlyArchived": "仅显示已归档",
    "sessions.expand": "展开其余 {n} 个会话",
    "sessions.collapse": "收起",
    "empty.none": "暂无会话",
    "empty.noneArchived": "暂无已归档会话",
    "empty.viewOthers": "查看其他会话",
    "empty.noMatches": "无匹配结果",
    "workspace.add": "添加工作区",
    "search.sessions.aria": "搜索会话",
    "search.placeholder": "搜索会话名称",
    "search.clear": "清除搜索",
    "search.results.aria": "搜索结果",
    "search.pending": "正在搜索会话历史…",
    "search.noMatches": "无匹配会话",
    "search.hasMore": "仅显示前 {n} 条结果，请缩小搜索范围。",
    "menu.addWorkspace": "添加工作区…",
    "picker.loading": "正在加载工作区…",
    "conflict.named": "已存在名为“{name}”的工作区。",
    "folderError.title": "无法打开文件夹",
    "folderError.retry": "重新选择",
    "rename": "重命名",
    "rename.workspace.title": "重命名工作区",
    "rename.session.title": "重命名会话",
    "field.workspaceName": "工作区名称",
    "field.sessionName": "会话名称",
    "delete.workspace": "删除工作区",
    "delete.desc": "将把“{name}”从工作区列表中移除。文件夹与会话记录会保留，其会话将显示在“未分组”下。",
    "delete.pending": "正在删除工作区…",
    "menu.fork": "分叉会话",
    "menu.archiveSession": "归档会话",
    "menu.unarchiveSession": "取消归档",
    "menu.pinSession": "置顶会话",
    "menu.unpinSession": "取消置顶",
    "menu.sessionId": "复制 Session ID",
    "toast.sessionIdCopied": "Session ID 已复制",
    "toast.sessionIdCopyFailed": "复制失败，请重试",
    "row.archived": "已归档",
    "row.pinned": "已置顶",
    "toast.archivedNotOpenable": "已归档对话暂时无法查看，请取消归档后查看",
    "toast.archived": "会话已归档，可",
    "toast.stoppedAndArchived": "已停止并归档，可",
    "archive.confirm.title": "停止并归档此会话？",
    "archive.confirm.desc": "“{title}”仍有正在进行的工作。归档会先停止这些工作；之后可在侧栏筛选“全部对话（显示已归档）”中恢复会话，被停止的工作不会自动继续。",
    "archive.confirm.activity": "将被停止的工作",
    "archive.confirm.turn": "进行中的回合",
    "archive.confirm.subagents.one": "{n} 个运行中的子智能体：{names}",
    "archive.confirm.subagents.other": "{n} 个运行中的子智能体：{names}",
    "archive.confirm.jobs.one": "{n} 个后台任务：{names}",
    "archive.confirm.jobs.other": "{n} 个后台任务：{names}",
    "archive.confirm.schedules.one": "{n} 条定时提醒：{names}",
    "archive.confirm.schedules.other": "{n} 条定时提醒：{names}",
    "archive.confirm.other.one": "{n} 项其他工作（{kind}）",
    "archive.confirm.other.other": "{n} 项其他工作（{kind}）",
    "archive.confirm.listSeparator": "、",
    "archive.confirm.action": "停止并归档",
    "archive.confirm.pending": "正在停止并归档…",
    "toast.archivedUndo": "撤销",
    "toast.archivedOr": "或",
    "toast.archivedFilter": "筛选已归档会话",
    "toast.pinFailed": "置顶失败，请稍后重试",
    "toast.unpinFailed": "取消置顶失败，请稍后重试",
    "toast.createFailed": "新建会话失败：{message}",
    "toast.forkRequiresOpen": "请先打开原会话完成迁移，再创建分支",
    "toast.openForkSource": "打开原会话",
    "sessions.count.one": "{n} 个会话",
    "sessions.count.other": "{n} 个会话",
    "actions.workspace.aria": "工作区“{name}”的操作",
    "actions.session.aria": "会话“{name}”的操作",
    "actions.archive": "归档会话",
    "actions.unarchive": "取消归档",
    "actions.pin": "置顶会话",
    "actions.unpin": "取消置顶",
    "actions.newSession": "新会话",
    "actions.newSession.aria": "在“{name}”中新建会话",
    "status.running": "进行中",
    "status.subagentsRunning.one": "{n} 个子智能体运行中",
    "status.subagentsRunning.other": "{n} 个子智能体运行中",
    "status.idle": "空闲",
    "status.waitingApproval": "等待审批",
    "status.planReview": "计划待审",
    "status.waitingAnswer": "等待回答",
    "status.compact.approval": "待审批",
    "status.compact.planReview": "计划待审",
    "status.compact.answer": "待回答",
    "status.completed": "已完成",
    "hover.created": "创建于 {time}",
    "hover.copied": "已复制",
    "date.ymd": "{y}年{m}月{d}日",
    "time.now": "刚刚",
    "time.minutes": "{n}分钟",
    "time.hours": "{n}小时",
    "time.days": "{n}天",
    "time.months": "{n}个月",
    "time.years": "{n}年",
    "time.ago": "{t}前"
  },
  "en": {
    "defaultWorkspace.failed": "Unable to create default workspace. Use Choose workspace to select a folder.",
    "draft.workspaceRequired": "Choose a workspace first.",
    "draft.initializationFailed": "Could not fill the draft. Please try again shortly.",
    "group.ungrouped": "Ungrouped",
    "session.new": "New Session",
    "session.untitled": "Untitled",
    "shortcut.noSession": "Select a session first",
    "shortcut.noPicker": "Directory picker unavailable",
    "shortcut.directoryBusy": "Selecting or adding a workspace",
    "shortcut.noCompletedTurn": "This session has no completed turn",
    "shortcut.forkFailed": "Could not fork the session. Try again.",
    "section.workspaces": "Workspaces",
    "section.sessions": "Sessions",
    "viewOptions.label": "View options",
    "groupBy.label": "Group by",
    "groupBy.workspace": "WorkSpace",
    "groupBy.workspaceTree": "Workspace Tree",
    "groupBy.flat": "In one list",
    "orderBy.label": "Order by",
    "orderBy.manual": "Manual",
    "orderBy.updated": "Last updated",
    "filterBy.label": "Filter sessions",
    "viewOptions.hideArchived": "Hide archived",
    "viewOptions.showArchived": "All conversations (show archived)",
    "viewOptions.onlyArchived": "Archived only",
    "sessions.expand": "Show {n} more sessions",
    "sessions.collapse": "Show less",
    "empty.none": "No sessions yet",
    "empty.noneArchived": "No archived sessions yet",
    "empty.viewOthers": "View other sessions",
    "empty.noMatches": "No matches",
    "workspace.add": "Add workspace",
    "search.sessions.aria": "Search sessions",
    "search.placeholder": "Search session names",
    "search.clear": "Clear search",
    "search.results.aria": "Search results",
    "search.pending": "Searching session history…",
    "search.noMatches": "No matching sessions",
    "search.hasMore": "Showing the first {n} results. Narrow your search.",
    "menu.addWorkspace": "Add workspace…",
    "picker.loading": "Loading workspaces…",
    "conflict.named": "A workspace named “{name}” already exists.",
    "folderError.title": "Couldn’t open folder",
    "folderError.retry": "Choose again",
    "rename": "Rename",
    "rename.workspace.title": "Rename workspace",
    "rename.session.title": "Rename session",
    "field.workspaceName": "Workspace name",
    "field.sessionName": "Session name",
    "delete.workspace": "Delete workspace",
    "delete.desc": "This removes “{name}” from the workspace list. The folder and session logs will be kept. Its sessions will appear under Ungrouped.",
    "delete.pending": "Deleting workspace…",
    "menu.fork": "Fork session",
    "menu.archiveSession": "Archive session",
    "menu.unarchiveSession": "Unarchive session",
    "menu.pinSession": "Pin session",
    "menu.unpinSession": "Unpin session",
    "menu.sessionId": "Copy Session ID",
    "toast.sessionIdCopied": "Session ID copied",
    "toast.sessionIdCopyFailed": "Copy failed. Try again.",
    "row.archived": "Archived",
    "row.pinned": "Pinned",
    "toast.archivedNotOpenable": "Archived sessions cannot be opened. Unarchive it to view.",
    "toast.archived": "Session archived. You can ",
    "toast.stoppedAndArchived": "Session stopped and archived. You can ",
    "archive.confirm.title": "Stop and archive this session?",
    "archive.confirm.desc": "“{title}” still has work in progress. Archiving stops it first; you can restore the session later from the “All conversations (show archived)” filter in the sidebar, and the stopped work will not resume on its own.",
    "archive.confirm.activity": "Work that will be stopped",
    "archive.confirm.turn": "The turn in progress",
    "archive.confirm.subagents.one": "{n} running subagent: {names}",
    "archive.confirm.subagents.other": "{n} running subagents: {names}",
    "archive.confirm.jobs.one": "{n} background job: {names}",
    "archive.confirm.jobs.other": "{n} background jobs: {names}",
    "archive.confirm.schedules.one": "{n} scheduled reminder: {names}",
    "archive.confirm.schedules.other": "{n} scheduled reminders: {names}",
    "archive.confirm.other.one": "{n} other item of work ({kind})",
    "archive.confirm.other.other": "{n} other items of work ({kind})",
    "archive.confirm.listSeparator": ", ",
    "archive.confirm.action": "Stop and archive",
    "archive.confirm.pending": "Stopping and archiving…",
    "toast.archivedUndo": "undo",
    "toast.archivedOr": " or ",
    "toast.archivedFilter": "filter archived sessions",
    "toast.pinFailed": "Pin failed. Try again later.",
    "toast.unpinFailed": "Unpin failed. Try again later.",
    "toast.createFailed": "New session failed: {message}",
    "toast.forkRequiresOpen": "Open the original session to complete migration before creating a branch.",
    "toast.openForkSource": "Open original session",
    "sessions.count.one": "{n} session",
    "sessions.count.other": "{n} sessions",
    "actions.workspace.aria": "Workspace actions for {name}",
    "actions.session.aria": "Session actions for {name}",
    "actions.archive": "Archive",
    "actions.unarchive": "Unarchive",
    "actions.pin": "Pin",
    "actions.unpin": "Unpin",
    "actions.newSession": "New session",
    "actions.newSession.aria": "New session in {name}",
    "status.running": "Running",
    "status.subagentsRunning.one": "{n} subagent running",
    "status.subagentsRunning.other": "{n} subagents running",
    "status.idle": "Idle",
    "status.waitingApproval": "Waiting for approval",
    "status.planReview": "Plan awaiting review",
    "status.waitingAnswer": "Waiting for answer",
    "status.compact.approval": "Approval",
    "status.compact.planReview": "Plan review",
    "status.compact.answer": "Answer",
    "status.completed": "Completed",
    "hover.created": "Created {time}",
    "hover.copied": "Copied",
    "date.ymd": "{y}-{m}-{d}",
    "time.now": "now",
    "time.minutes": "{n}min",
    "time.hours": "{n}h",
    "time.days": "{n}d",
    "time.months": "{n}mo",
    "time.years": "{n}y",
    "time.ago": "{t} ago"
  }
};
/**
* Workspace browser tree row components (figma Cell set 14:3080): pure presentational —
* all data and callbacks arrive via props. Hover swaps (folder->chevron,
* time->ellipsis, action buttons) are CSS-only, and a session row's clipped
* title marquees programmatically while the row is hovered. Workspace row
* menus are visual-only except Rename/Delete. A Session row's "..." menu and
* its hover buttons are the `sidebar.workspaces.session.menu.item` and
* `sidebar.workspaces.session.row.action` lists, rendered through the
* browser's `renderSlot` with the menu's open state as the occurrence's hook
* context; this package's own actions are entries like any plugin's. The
* session and workspace hover cards are suppressed while a menu is open.
*/
/** Row display title: blank rows show the localized New Session label. */
function displayTitle(node, t) {
	return node.blank ? t("session.new") : node.title || t("session.untitled");
}
const MIN_TITLE_REVEAL_PX = 8;
const TITLE_MARQUEE_PX_PER_MS = .03;
/**
* Place the title's scroll position and publish the stylesheet's fade-mask
* hooks: `data-scrolled` while the title has left its start (left fade) and
* `data-clipped` while text remains beyond the right edge (right fade).
* @param title - the row's clipping title element.
* @param left - scroll offset in CSS pixels.
* @param range - the title's maximum scroll offset in CSS pixels.
*/
function placeTitle(title, left, range) {
	if (typeof title.scrollTo === "function") title.scrollTo({
		left,
		behavior: "instant"
	});
	else title.scrollLeft = left;
	if (left > 0) title.dataset.scrolled = "";
	else delete title.dataset.scrolled;
	if (left < range) title.dataset.clipped = "";
	else delete title.dataset.clipped;
}
/**
* Return the title to its resting state: scrolled to the start with both fade
* masks off, so the resting ellipsis renders at full strength.
* @param title - the row's clipping title element.
*/
function restTitle(title) {
	if (typeof title.scrollTo === "function") title.scrollTo({
		left: 0,
		behavior: "instant"
	});
	else title.scrollLeft = 0;
	delete title.dataset.scrolled;
	delete title.dataset.clipped;
}
/**
* Marquee a title wider than its one-line cell while its row is hovered: the
* title clips its own text, so entering crawls it at a constant speed until the
* far edge (a fork's incremented title, for example) is in view, then rests
* there under the pointer. Overflow of at most {@link MIN_TITLE_REVEAL_PX}
* stays put — a barely-clipped title moving a few pixels reads as jitter, not a
* reveal. Leaving returns the title to the start in one step, because the
* resting ellipsis and the narrowed cell would otherwise meet the text while it
* travelled back. Reduced motion jumps to the far edge instead of crawling.
* @param title - ref to the row's clipping title element.
* @returns stable pointer enter/leave handlers for the row.
*/
function useTitleMarquee(title) {
	const frame = (0, react.useRef)(0);
	(0, react.useEffect)(() => () => {
		cancelAnimationFrame(frame.current);
	}, []);
	return (0, react.useMemo)(() => ({
		enter: () => {
			/* v8 ignore next -- defensive: the title span renders unconditionally. */
			if (title.current === null) return;
			const element = title.current;
			const range = element.scrollWidth - element.clientWidth;
			if (range <= MIN_TITLE_REVEAL_PX) return;
			if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
				placeTitle(element, range, range);
				return;
			}
			cancelAnimationFrame(frame.current);
			let previous;
			let position = 0;
			const step = (now) => {
				position += previous === void 0 ? 0 : (now - previous) * TITLE_MARQUEE_PX_PER_MS;
				previous = now;
				placeTitle(element, Math.min(position, range), range);
				if (position < range) frame.current = requestAnimationFrame(step);
			};
			frame.current = requestAnimationFrame(step);
		},
		leave: () => {
			cancelAnimationFrame(frame.current);
			/* v8 ignore next -- defensive: the title span renders unconditionally. */
			if (title.current === null) return;
			restTitle(title.current);
		}
	}), [title]);
}
/** Localized compact relative time ("刚刚"/"5分钟" in zh, "now"/"5min" in en). */
function timeLabel(updatedAt, now, t) {
	const { unit, n } = (0, _deepseek_ai_dsh_client_ui_primitives.relativeTime)(updatedAt, now);
	return unit === "now" ? t("time.now") : t(`time.${unit}`, { n });
}
/** Hover-card variant: distances wrap in the ago template; the now bucket stays bare (no "now ago"). */
function hoverTimeLabel(updatedAt, now, t) {
	const { unit, n } = (0, _deepseek_ai_dsh_client_ui_primitives.relativeTime)(updatedAt, now);
	return unit === "now" ? t("time.now") : t("time.ago", { t: t(`time.${unit}`, { n }) });
}
/**
* Absolute creation time through the dictionary's date template (the message
* clock pattern): `toLocaleString` would follow the browser language, not the
* app locale, and produce mixed-language text after a switch.
*/
function createdLabel(createdAt, t) {
	const d = new Date(createdAt);
	const pad2 = (v) => String(v).padStart(2, "0");
	return t("hover.created", { time: `${t("date.ymd", {
		y: d.getFullYear(),
		m: d.getMonth() + 1,
		d: d.getDate()
	})} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` });
}
/** Hover-card body: workspace title, display directory path, absolute creation time. */
function WorkspaceHoverContent({ label, cwd, createdAt, t }) {
	return (0, react_jsx_runtime.jsxs)("div", {
		className: Rows_module_css_default.hoverContent,
		children: [
			(0, react_jsx_runtime.jsx)("div", {
				className: Rows_module_css_default.hoverTitle,
				children: label
			}),
			(0, react_jsx_runtime.jsx)("div", {
				className: Rows_module_css_default.hoverPath,
				children: cwd
			}),
			(0, react_jsx_runtime.jsx)("div", {
				className: Rows_module_css_default.hoverTime,
				children: createdLabel(createdAt, t)
			})
		]
	});
}
/** Pointer-position half of a row (insert line above or below). */
function rowHalf(e) {
	const rect = e.currentTarget.getBoundingClientRect();
	return e.clientY < rect.top + rect.height / 2 ? "before" : "after";
}
/**
* Project (workspace) header row: folder + title;
* hover reveals the chevron and create button, and dwelling on a real
* Workspace shows its hover card (the ungrouped bucket has none).
* `containsCurrent` arrives on the node (derivation fact, no renderer scan).
* @param props.group - derived group node.
* @param props.containsCurrentDescendant - highlight an ancestor even when its subtree is collapsed.
* @param props.onToggle - expand/collapse the group.
* @param props.onCreate - start a frontend Session inside this Workspace.
* @param props.drag - optional workspace-row drag wiring.
* @param props.home - host account home for POSIX hover-path abbreviation.
* @param props.t - the browser root's locale seat.
* @returns the row element.
*/
function ProjectRowItem({ group, containsCurrentDescendant = false, onToggle, onCreate, actions, drag, home, newShortcut, t }) {
	const row = group;
	const label = row.workspaceId === void 0 ? t("group.ungrouped") : row.label;
	const active = containsCurrentDescendant || group.expanded && group.containsCurrent;
	const [menuOpen, setMenuOpen] = (0, react.useState)(false);
	const workspaceMenuItems = [{
		id: "rename",
		label: t("rename"),
		icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEditOutlineRegular, {})
	}, {
		id: "delete",
		label: t("delete.workspace"),
		icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutlineRegular, {}),
		danger: true
	}];
	const ownRow = (0, react_jsx_runtime.jsxs)("div", {
		className: clsx(Rows_module_css_default.projectRow, menuOpen && Rows_module_css_default.menuOpen),
		"data-row-key": `workspace:${group.key}`,
		role: "treeitem",
		"aria-expanded": row.expanded,
		onClick: onToggle,
		draggable: drag !== void 0,
		onDragStart: drag === void 0 ? void 0 : (e) => {
			e.dataTransfer.effectAllowed = "move";
			e.dataTransfer.setData("text/plain", row.key);
			drag.start();
		},
		onDragEnd: drag?.end,
		children: [
			(0, react_jsx_runtime.jsx)("span", {
				className: clsx(Rows_module_css_default.slot, Rows_module_css_default.folder, active && Rows_module_css_default.folderActive),
				children: row.expanded ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderOpenRegular, {}) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderCloseRegular, {})
			}),
			(0, react_jsx_runtime.jsx)("span", {
				className: clsx(Rows_module_css_default.slot, Rows_module_css_default.chevron),
				children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTriangleRightFillRegular, { className: clsx(Rows_module_css_default.arrow, row.expanded && Rows_module_css_default.arrowOpen) })
			}),
			(0, react_jsx_runtime.jsx)("span", {
				className: Rows_module_css_default.projectText,
				children: (0, react_jsx_runtime.jsx)("span", {
					className: Rows_module_css_default.title,
					children: label
				})
			}),
			(0, react_jsx_runtime.jsxs)("span", {
				className: Rows_module_css_default.rowActions,
				children: [actions !== void 0 && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
					open: menuOpen,
					onClose: () => {
						setMenuOpen(false);
					},
					items: workspaceMenuItems,
					onSelect: (id) => {
						setMenuOpen(false);
						if (id === "rename") actions.rename();
						if (id === "delete") actions.delete();
					},
					portal: true,
					closeOnPointerLeave: true,
					anchor: (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: Rows_module_css_default.iconButton,
						"aria-label": t("actions.workspace.aria", { name: label }),
						onClick: (e) => {
							e.stopPropagation();
							setMenuOpen((v) => !v);
						},
						children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEllipsisOutlineRegular, {})
					})
				}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
					label: t("actions.newSession"),
					shortcutKeys: newShortcut?.keys,
					side: "bottom",
					align: "end",
					delayMs: 500,
					portal: true,
					children: (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: Rows_module_css_default.iconButton,
						"aria-keyshortcuts": newShortcut?.aria,
						"aria-label": t("actions.newSession.aria", { name: label }),
						onClick: (e) => {
							e.stopPropagation();
							onCreate();
						},
						children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconNewChatOutlineRegular, {})
					})
				})]
			})
		]
	});
	if (row.createdAt === void 0) return ownRow;
	return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.HoverCard, {
		anchor: ownRow,
		content: (0, react_jsx_runtime.jsx)(WorkspaceHoverContent, {
			label: row.label,
			cwd: row.cwd,
			createdAt: row.createdAt,
			t
		}),
		openDelayMs: 800,
		grouped: true,
		disabled: menuOpen,
		copyText: row.cwd,
		copyLabel: t("copy"),
		copiedLabel: t("hover.copied")
	});
}
/* v8 ignore next 3 -- closed-union backstop; only reached if the status is forged */
function assertNever(value) {
	throw new Error(`unknown pending interaction: ${String(value)}`);
}
/**
* Session status presentation; pending interaction is primary and live activity
* outranks completion reminders.
*/
function sessionStatuses(node, t) {
	const subagents = node.runningSubagentCount === 0 ? void 0 : {
		state: "ongoing",
		label: t(node.runningSubagentCount === 1 ? "status.subagentsRunning.one" : "status.subagentsRunning.other", { n: node.runningSubagentCount })
	};
	let pending;
	switch (node.pendingInteraction) {
		case "approval":
			pending = {
				state: "warning",
				label: t("status.waitingApproval"),
				trailingLabel: t("status.compact.approval")
			};
			break;
		case "plan-review":
			pending = {
				state: "warning",
				label: t("status.planReview"),
				trailingLabel: t("status.compact.planReview")
			};
			break;
		case "question":
			pending = {
				state: "warning",
				label: t("status.waitingAnswer"),
				trailingLabel: t("status.compact.answer")
			};
			break;
		case void 0: break;
		/* v8 ignore next -- closed PendingInteractionStatus union */
		default: return assertNever(node.pendingInteraction);
	}
	if (pending !== void 0) return subagents === void 0 ? [pending] : [pending, subagents];
	if (node.running) {
		const primary = {
			state: "ongoing",
			label: t("status.running")
		};
		return subagents === void 0 ? [primary] : [primary, subagents];
	}
	if (subagents !== void 0) return [subagents];
	if (node.completed) return [{
		state: "done",
		label: t("status.completed")
	}];
	return [{
		state: "idle",
		label: t("status.idle")
	}];
}
/** Primary status dot plus every status's screen-reader label, shared by the search and session rows. */
function SessionStatusDots({ statuses }) {
	return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: statuses[0].state }), statuses.map((status) => (0, react_jsx_runtime.jsx)("span", {
		className: Rows_module_css_default.visuallyHidden,
		children: status.label
	}, status.label))] });
}
/** Non-interactive pinned-row marker; the enclosing row remains the only action. */
function PinnedIndicator({ t }) {
	const label = t("row.pinned");
	return (0, react_jsx_runtime.jsx)("span", {
		className: Rows_module_css_default.pinIndicator,
		role: "img",
		"aria-label": label,
		title: label,
		children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPinFillRegular, { size: 14 })
	});
}
/**
* Hover-card body: full title, relative time, the Session's own scheduled-task
* section, and every relevant live status. The task section sits above the
* status lines so they stay the card's trailing status line.
*/
function SessionHoverContent({ node, now, renderSlot, t }) {
	const statuses = sessionStatuses(node, t).filter((status) => !(node.archived && (status.state === "done" || status.state === "idle")));
	return (0, react_jsx_runtime.jsxs)("div", {
		className: Rows_module_css_default.hoverContent,
		children: [
			(0, react_jsx_runtime.jsx)("div", {
				className: Rows_module_css_default.hoverTitle,
				children: displayTitle(node, t)
			}),
			!node.blank && (0, react_jsx_runtime.jsx)("div", {
				className: Rows_module_css_default.hoverTime,
				children: hoverTimeLabel(node.updatedAt, now, t)
			}),
			renderSlot("sidebar.session.row.hover", { sessionId: node.id }),
			statuses.map((status) => (0, react_jsx_runtime.jsxs)("div", {
				className: Rows_module_css_default.hoverStatus,
				children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: status.state }), (0, react_jsx_runtime.jsx)("span", { children: status.label })]
			}, status.label)),
			node.archived && (0, react_jsx_runtime.jsxs)("div", {
				className: clsx(Rows_module_css_default.hoverStatus, Rows_module_css_default.hoverArchived),
				children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconArchiveOutlineRegular, { size: 14 }), (0, react_jsx_runtime.jsx)("span", { children: t("row.archived") })]
			})
		]
	});
}
/**
* One top-level 32px session row: leading 16px cell (status dot, or the
* leading seat while the row's primary state is idle), title, relative time or
* compact pending label, and the row actions menu. A row that owns a state dot
* keeps that cell and renders no seat, so an ambient automation mark never
* appears beside the row's own state dot. An archived row keeps the cell blank:
* neither marker renders there, and its live status stays on the hover card.
* @param props.node - derived session node.
* @param props.currentId - selected session id (row highlight).
* @param props.now - epoch ms for relative-time formatting.
* @param props.onOpen - open a session by id.
* @param props.onRenameRequest - open the rename dialog from a title double-click (id + current title).
* @param props.renderSlot - child-seat renderer for the row's action lists
* (`sidebar.workspaces.session.menu.item` / `sidebar.workspaces.session.row.action`),
* its leading decoration, and its hover-card section.
* @param props.onReveal - scroll this row into view after search navigation, then acknowledge it.
* @param props.drag - optional row-drag target wiring; blank rows cannot start a drag.
* @param props.t - the browser root's locale seat.
* @returns the session row.
*/
function SessionNodeItem({ node, currentId, now, onOpen, onRenameRequest, renderSlot, onReveal, drag, t }) {
	const row = node;
	const title = displayTitle(node, t);
	const selected = node.id === currentId;
	const statuses = sessionStatuses(node, t);
	const primaryStatus = statuses[0];
	const showStatus = primaryStatus.state !== "idle";
	const draggable = drag !== void 0 && !row.blank && !row.archived;
	const [menuOpen, setMenuOpen] = (0, react.useState)(false);
	const menuOpenState = (0, react.useMemo)(() => [menuOpen, setMenuOpen], [menuOpen]);
	const rowRef = (0, react.useRef)(null);
	const titleRef = (0, react.useRef)(null);
	const marquee = useTitleMarquee(titleRef);
	(0, react.useEffect)(() => {
		if (onReveal === void 0) return;
		rowRef.current?.scrollIntoView({ block: "nearest" });
		onReveal();
	}, [onReveal]);
	return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.HoverCard, {
		anchor: (0, react_jsx_runtime.jsxs)("div", {
			ref: rowRef,
			"data-row-key": `session:${node.id}`,
			className: clsx(Rows_module_css_default.sessionRow, selected && Rows_module_css_default.selected, menuOpen && Rows_module_css_default.menuOpen, row.archived && Rows_module_css_default.archived, drag?.marker === "before" && Rows_module_css_default.dropBefore, drag?.marker === "after" && Rows_module_css_default.dropAfter),
			role: "treeitem",
			"aria-selected": selected,
			"aria-description": row.archived ? t("toast.archivedNotOpenable") : void 0,
			onClick: () => {
				onOpen(node.id);
			},
			onPointerEnter: marquee.enter,
			onPointerLeave: marquee.leave,
			draggable,
			onDragStart: !draggable ? void 0 : (e) => {
				e.dataTransfer.effectAllowed = "move";
				e.dataTransfer.setData("text/plain", node.id);
				drag.start();
			},
			onDragEnd: !draggable ? void 0 : drag.end,
			onDragOver: drag === void 0 ? void 0 : (e) => {
				if (!drag.active) return;
				e.preventDefault();
				e.dataTransfer.dropEffect = "move";
				drag.hover(rowHalf(e));
			},
			onDrop: drag === void 0 ? void 0 : (e) => {
				if (!drag.active) return;
				e.preventDefault();
				drag.drop(rowHalf(e));
			},
			children: [
				(0, react_jsx_runtime.jsx)("span", {
					className: Rows_module_css_default.slot,
					children: !row.archived && !row.blank && (showStatus ? (0, react_jsx_runtime.jsx)(SessionStatusDots, { statuses }) : renderSlot("sidebar.session.row.leading", { sessionId: node.id }))
				}),
				(0, react_jsx_runtime.jsx)("span", {
					ref: titleRef,
					className: Rows_module_css_default.title,
					onDoubleClick: row.blank ? void 0 : (e) => {
						e.stopPropagation();
						onRenameRequest(node.id, row.title);
					},
					children: title
				}),
				!row.blank && (0, react_jsx_runtime.jsx)("span", {
					className: Rows_module_css_default.time,
					"aria-hidden": primaryStatus.trailingLabel === void 0 ? void 0 : true,
					children: primaryStatus.trailingLabel ?? timeLabel(row.updatedAt, now, t)
				}),
				row.pinned && !row.archived && (0, react_jsx_runtime.jsx)(PinnedIndicator, { t }),
				!row.blank && (0, react_jsx_runtime.jsxs)("span", {
					className: Rows_module_css_default.rowActions,
					onClick: (e) => {
						e.stopPropagation();
					},
					children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
						open: menuOpen,
						onClose: () => {
							setMenuOpen(false);
						},
						portal: true,
						closeOnPointerLeave: true,
						anchor: (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: Rows_module_css_default.iconButton,
							"aria-label": t("actions.session.aria", { name: title }),
							onClick: () => {
								setMenuOpen((v) => !v);
							},
							children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEllipsisOutlineRegular, {})
						}),
						children: renderSlot("sidebar.workspaces.session.menu.item", {
							sessionId: node.id,
							displayTitle: row.title,
							closeMenu: () => setMenuOpen(false)
						}, { hookContext: menuOpenState })
					}), renderSlot("sidebar.workspaces.session.row.action", {
						sessionId: node.id,
						displayTitle: row.title
					})]
				})
			]
		}),
		content: (0, react_jsx_runtime.jsx)(SessionHoverContent, {
			node,
			now,
			renderSlot,
			t
		}),
		openDelayMs: 800,
		grouped: true,
		disabled: menuOpen || drag?.active === true,
		copyText: row.blank || row.title === "" ? void 0 : row.title,
		copyLabel: t("copy"),
		copiedLabel: t("hover.copied")
	});
}

export {ProjectRowItem as LibraryRow, SessionNodeItem as TaskRow};
