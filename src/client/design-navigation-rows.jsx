import * as react from "react";
import * as react_jsx_runtime from "react/jsx-runtime";
import * as _deepseek_ai_dsh_client_ui_primitives from "@deepseek-ai/dsh-client-ui-primitives";
const clsx = (...names) => names.filter(Boolean).join(" ");
const Rows_module_css_default = {
  "archived": "mc-design-row-archived",
  "arrow": "mc-design-row-arrow",
  "arrowOpen": "mc-design-row-arrowOpen",
  "chevron": "mc-design-row-chevron",
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
  "pinIndicator": "mc-design-row-pinIndicator",
  "projectRow": "mc-design-row-projectRow",
  "projectText": "mc-design-row-projectText",
  "rowActions": "mc-design-row-rowActions",
  "selected": "mc-design-row-selected",
  "sessionRow": "mc-design-row-sessionRow",
  "slot": "mc-design-row-slot",
  "time": "mc-design-row-time",
  "title": "mc-design-row-title",
  "visuallyHidden": "mc-design-row-visuallyHidden"
};
export const workspaceClasses = {
  "clearButton": "mc-design-navigator-clearButton",
  "deleteAction": "mc-design-navigator-deleteAction",
  "groupSection": "mc-design-navigator-groupSection",
  "headerActions": "mc-design-navigator-headerActions",
  "headerActionsHidden": "mc-design-navigator-headerActionsHidden",
  "iconButton": "mc-design-navigator-iconButton",
  "list": "mc-design-navigator-list",
  "renameError": "mc-design-navigator-renameError",
  "root": "mc-design-navigator-root",
  "search": "mc-design-navigator-search",
  "searchButton": "mc-design-navigator-searchButton",
  "searchExpanded": "mc-design-navigator-searchExpanded",
  "searchInput": "mc-design-navigator-searchInput",
  "searchSlot": "mc-design-navigator-searchSlot",
  "searchSlotExpanded": "mc-design-navigator-searchSlotExpanded",
  "sectionHeader": "mc-design-navigator-sectionHeader",
  "sectionLabel": "mc-design-navigator-sectionLabel",
  "sectionLabelHidden": "mc-design-navigator-sectionLabelHidden",
  "wide": "mc-design-navigator-wide"
};
export const workspaceLocale = {
  "zh": {
    "group.ungrouped": "未分组",
    "session.new": "新会话",
    "session.untitled": "未命名",
    "viewOptions.hideArchived": "隐藏已归档",
    "viewOptions.showArchived": "全部对话（显示已归档）",
    "viewOptions.onlyArchived": "仅显示已归档",
    "rename": "重命名",
    "row.archived": "已归档",
    "row.pinned": "已置顶",
    "toast.archivedNotOpenable": "已归档对话暂时无法查看，请取消归档后查看",
    "actions.session.aria": "会话“{name}”的操作",
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
    "group.ungrouped": "Ungrouped",
    "session.new": "New Session",
    "session.untitled": "Untitled",
    "viewOptions.hideArchived": "Hide archived",
    "viewOptions.showArchived": "All conversations (show archived)",
    "viewOptions.onlyArchived": "Archived only",
    "rename": "Rename",
    "row.archived": "Archived",
    "row.pinned": "Pinned",
    "toast.archivedNotOpenable": "Archived sessions cannot be opened. Unarchive it to view.",
    "actions.session.aria": "Session actions for {name}",
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
function displayTitle(node, t) {
	return node.blank ? t("session.new") : node.title || t("session.untitled");
}
const MIN_TITLE_REVEAL_PX = 8;
const TITLE_MARQUEE_PX_PER_MS = .03;
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
function restTitle(title) {
	if (typeof title.scrollTo === "function") title.scrollTo({
		left: 0,
		behavior: "instant"
	});
	else title.scrollLeft = 0;
	delete title.dataset.scrolled;
	delete title.dataset.clipped;
}
function useTitleMarquee(title) {
	const frame = (0, react.useRef)(0);
	(0, react.useEffect)(() => () => {
		cancelAnimationFrame(frame.current);
	}, []);
	return (0, react.useMemo)(() => ({
		enter: () => {
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
			if (title.current === null) return;
			restTitle(title.current);
		}
	}), [title]);
}
function timeLabel(updatedAt, now, t) {
	const { unit, n } = (0, _deepseek_ai_dsh_client_ui_primitives.relativeTime)(updatedAt, now);
	return unit === "now" ? t("time.now") : t(`time.${unit}`, { n });
}
function hoverTimeLabel(updatedAt, now, t) {
	const { unit, n } = (0, _deepseek_ai_dsh_client_ui_primitives.relativeTime)(updatedAt, now);
	return unit === "now" ? t("time.now") : t("time.ago", { t: t(`time.${unit}`, { n }) });
}
function createdLabel(createdAt, t) {
	const d = new Date(createdAt);
	const pad2 = (v) => String(v).padStart(2, "0");
	return t("hover.created", { time: `${t("date.ymd", {
		y: d.getFullYear(),
		m: d.getMonth() + 1,
		d: d.getDate()
	})} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` });
}
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
function ProjectRowItem({ group, onToggle, onCreate, actions, t }) {
	const row = group;
	const label = row.workspaceId === void 0 ? t("group.ungrouped") : row.label;
	const active = group.expanded && group.containsCurrent;
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
	}, ...(actions?.items || [])];
	const ownRow = (0, react_jsx_runtime.jsxs)("div", {
		className: clsx(Rows_module_css_default.projectRow, menuOpen && Rows_module_css_default.menuOpen),
		"data-row-key": `workspace:${group.key}`,
		role: "treeitem",
		tabIndex: 0,
		"aria-expanded": row.expanded,
		onClick: onToggle,
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
						else if (id === "delete") actions.delete();
						else actions.select?.(id);
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
					side: "bottom",
					align: "end",
					delayMs: 500,
					portal: true,
					children: (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: Rows_module_css_default.iconButton,
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
			cwd: row.cwd === void 0 ? void 0 : row.cwd,
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
function assertNever(value) {
	throw new Error(`unknown pending interaction: ${String(value)}`);
}
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
function SessionStatusDots({ statuses }) {
	return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: statuses[0].state }), statuses.map((status) => (0, react_jsx_runtime.jsx)("span", {
		className: Rows_module_css_default.visuallyHidden,
		children: status.label
	}, status.label))] });
}
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
function SessionNodeItem({ node, currentId, now, onOpen, onRenameRequest, renderSlot, renderMenu, t }) {
	const row = node;
	const title = displayTitle(node, t);
	const selected = node.id === currentId;
	const statuses = sessionStatuses(node, t);
	const primaryStatus = statuses[0];
	const showStatus = primaryStatus.state !== "idle";
	const [menuOpen, setMenuOpen] = (0, react.useState)(false);
	const titleRef = (0, react.useRef)(null);
	const marquee = useTitleMarquee(titleRef);
	return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.HoverCard, {
		anchor: (0, react_jsx_runtime.jsxs)("div", {
			"data-row-key": `session:${node.id}`,
			className: clsx(Rows_module_css_default.sessionRow, selected && Rows_module_css_default.selected, menuOpen && Rows_module_css_default.menuOpen, row.archived && Rows_module_css_default.archived),
			role: "treeitem",
			tabIndex: 0,
			"aria-selected": selected,
			"aria-description": row.archived ? t("toast.archivedNotOpenable") : void 0,
			onClick: () => {
				onOpen(node.id);
			},
			onPointerEnter: marquee.enter,
			onPointerLeave: marquee.leave,
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
					children: [renderMenu({
						open: menuOpen,
						setOpen: setMenuOpen,
						anchor: (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: Rows_module_css_default.iconButton,
							"aria-label": t("actions.session.aria", { name: title }),
							onClick: () => {
								setMenuOpen((v) => !v);
							},
							children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEllipsisOutlineRegular, {})
						})
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
		disabled: menuOpen,
		copyText: row.blank || row.title === "" ? void 0 : row.title,
		copyLabel: t("copy"),
		copiedLabel: t("hover.copied")
	});
}

export { ProjectRowItem as DesignFolderRow, SessionNodeItem as TaskRow };
