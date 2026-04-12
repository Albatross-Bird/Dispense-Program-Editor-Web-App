// ── i18n dictionary ───────────────────────────────────────────────────────────
// Keys map to { en, zh } translation pairs.
// Use translate(key, lang, vars?) for variable substitution: {name} → value.

export type Lang = 'en' | 'zh';

const dict: Record<string, { en: string; zh: string }> = {
  // ── Menu ──────────────────────────────────────────────────────────────────
  'menu.file':       { en: 'File',                      zh: '文件' },
  'menu.open':       { en: 'Open...',                   zh: '打开...' },
  'menu.save':       { en: 'Save',                      zh: '保存' },
  'menu.saveAs':     { en: 'Save As...',                zh: '另存为...' },
  'menu.loadBg':     { en: 'Load Background Image...', zh: '加载背景图片...' },
  'menu.settings':   { en: 'Settings',                  zh: '设置' },

  // ── Toolbar ───────────────────────────────────────────────────────────────
  'toolbar.noFile': { en: 'No file open', zh: '未打开文件' },

  // ── Status bar ────────────────────────────────────────────────────────────
  'status.modified': { en: 'Modified',       zh: '已修改' },
  'status.ready':    { en: 'Ready',          zh: '就绪' },
  'status.noFile':   { en: 'No file',        zh: '无文件' },
  'status.fitView':  { en: 'Click to fit view (1×)', zh: '点击以适应视图 (1×)' },

  // ── Search bar ────────────────────────────────────────────────────────────
  'search.placeholder':    { en: 'Search…',            zh: '搜索…' },
  'search.replacePh':      { en: 'Replace with…',      zh: '替换为…' },
  'search.noMatches':      { en: 'No matches',          zh: '无匹配结果' },
  'search.showReplace':    { en: 'Show replace (Ctrl+H)', zh: '显示替换 (Ctrl+H)' },
  'search.hideReplace':    { en: 'Hide replace',        zh: '隐藏替换' },
  'search.scope.pattern':  { en: 'Current Pattern',     zh: '当前图案' },
  'search.scope.program':  { en: 'Entire Program',      zh: '整个程序' },
  'search.scope.selection':{ en: 'Selection Only',      zh: '仅选中项' },
  'search.replaceBtn':     { en: 'Replace',              zh: '替换' },
  'search.allBtn':         { en: 'All',                  zh: '全部' },
  'search.replacedCount':  { en: 'Replaced {count} occurrence(s)', zh: '已替换 {count} 处' },

  // ── Pattern selector ──────────────────────────────────────────────────────
  'pattern.noFile':          { en: 'No file open',              zh: '未打开文件' },
  'pattern.newSubpattern':   { en: 'New Subpattern',            zh: '新建子图案' },
  'pattern.deleteSubpattern':{ en: 'Delete Current Subpattern', zh: '删除当前子图案' },
  'pattern.main':            { en: 'Main',                      zh: '主程序' },
  'pattern.historyToggle':   { en: 'Toggle history panel',      zh: '切换历史面板' },

  // ── New Subpattern dialog ─────────────────────────────────────────────────
  'dialog.newSub.title':    { en: 'New Subpattern',                          zh: '新建子图案' },
  'dialog.newSub.name':     { en: 'Name',                                    zh: '名称' },
  'dialog.newSub.copyFrom': { en: 'Copy from',                               zh: '复制自' },
  'dialog.newSub.empty':    { en: 'Empty',                                   zh: '空白' },
  'dialog.newSub.errEmpty': { en: 'Name cannot be empty',                    zh: '名称不能为空' },
  'dialog.newSub.errExists':{ en: 'A subpattern with this name already exists', zh: '同名子图案已存在' },
  'dialog.create':          { en: 'Create', zh: '创建' },
  'dialog.cancel':          { en: 'Cancel', zh: '取消' },

  // ── Delete Subpattern dialog ──────────────────────────────────────────────
  'dialog.delSub.title':    { en: 'Delete Subpattern',       zh: '删除子图案' },
  'dialog.delSub.body':     { en: 'Delete subpattern {name} and all its commands?', zh: '删除子图案 {name} 及其所有命令？' },
  'dialog.delete':          { en: 'Delete', zh: '删除' },

  // ── Discard plain-text dialog ─────────────────────────────────────────────
  'dialog.discard.title':   { en: 'Syntax errors in text',  zh: '文本语法错误' },
  'dialog.discard.body':    { en: 'The text has syntax errors. Discard changes and revert to the last valid state?', zh: '文本存在语法错误，是否丢弃更改并还原至最后有效状态？' },
  'dialog.discard.stay':    { en: 'Stay in Plain Text', zh: '保留原始文本' },
  'dialog.discard.discard': { en: 'Discard',            zh: '丢弃' },

  // ── Open file prompt ──────────────────────────────────────────────────────
  'app.openFile': { en: 'Open a .prg file to begin', zh: '打开 .prg 文件以开始' },

  // ── Raw mode ──────────────────────────────────────────────────────────────
  'raw.label': { en: 'Raw', zh: '原始' },

  // ── Tool panel ────────────────────────────────────────────────────────────
  'tool.contourFill':   { en: 'Contour Fill — draw polygon',            zh: '轮廓填充——绘制多边形' },
  'tool.newLine':       { en: 'New Line (click 2 points; Esc to stop)', zh: '新建线段（点击两点；Esc 停止）' },
  'tool.newDot':        { en: 'New Dot (click to place; Esc to stop)',  zh: '新建点（点击放置；Esc 停止）' },
  'tool.newComment':    { en: 'New Comment',                            zh: '新建注释' },
  'tool.mergeES':       { en: 'Merge: move 1st end → 2nd start',       zh: '合并：第1条终点移至第2条起点' },
  'tool.mergeSE':       { en: 'Merge: move 2nd start → 1st end',       zh: '合并：第2条起点移至第1条终点' },
  'tool.disconnect':    { en: 'Disconnect joined lines',                zh: '断开连接线段' },
  'tool.splitLine':     { en: 'Split line — click along a line',        zh: '分割线段——沿线点击' },
  'tool.joinLines':     { en: 'Join lines — click a junction',          zh: '合并线段——点击交汇处' },
  'tool.areaFill':      { en: 'Area Fill — draw polygon',               zh: '区域填充——绘制多边形' },
  'tool.group':         { en: 'Group selection',                        zh: '创建分组' },
  'tool.ungroup':       { en: 'Ungroup',                                zh: '取消分组' },
  'tool.deleteSelected':{ en: 'Delete {count} selected',               zh: '删除已选 {count} 项' },
  'tool.deleteTool':    { en: 'Delete tool — click commands to delete', zh: '删除工具——点击命令删除' },

  // ── Comment tool ──────────────────────────────────────────────────────────
  'comment.placeholder': { en: 'Enter comment text…', zh: '输入注释文本…' },
  'comment.reserved':    { en: 'This comment syntax is reserved for internal use. Please use different text.', zh: '此注释语法为内部保留，请使用其他文本。' },

  // ── Chain mode ────────────────────────────────────────────────────────────
  'chain.label':   { en: 'Chain',                                   zh: '连续' },
  'chain.tooltip': { en: 'Chain mode: connect lines end-to-start',  zh: '连续模式：线段终点连接起点' },

  // ── Group prompt ──────────────────────────────────────────────────────────
  'group.nameLabel': { en: 'Group name', zh: '分组名称' },
  'group.namePh':    { en: 'My Group',   zh: '我的分组' },

  // ── Area Fill panel ───────────────────────────────────────────────────────
  'af.title':        { en: 'Area Fill',       zh: '区域填充' },
  'af.editTitle':    { en: 'Edit Area Fill',  zh: '编辑区域填充' },
  'af.fillName':     { en: 'Fill Name',       zh: '填充名称' },
  'af.fillNamePh':   { en: 'Custom name…',    zh: '自定义名称…' },
  'af.lockSpacing':  { en: 'Lock X/Y spacing together', zh: '锁定 X/Y 间距' },
  'af.polyReady':    { en: 'Polygon ready — {n} vertices',                        zh: '多边形已就绪 — {n} 个顶点' },
  'af.polyStart':    { en: 'Click on the canvas to place polygon vertices',       zh: '点击画布放置多边形顶点' },
  'af.polyProgress': { en: '{n} {v} placed — double-click to close',             zh: '{n} 个顶点已放置 — 双击关闭' },
  'af.vertex':       { en: 'vertex',    zh: '个顶点' },
  'af.vertices':     { en: 'vertices',  zh: '个顶点' },
  'af.fillType':     { en: 'Fill type', zh: '填充类型' },
  'af.dots':         { en: 'Dots',      zh: '点阵' },
  'af.lines':        { en: 'Lines',     zh: '线条' },
  'af.xSpacing':     { en: 'X Spacing', zh: 'X 间距' },
  'af.ySpacing':     { en: 'Y Spacing', zh: 'Y 间距' },
  'af.zHeight':      { en: 'Z Height',  zh: 'Z 高度' },
  'af.rotation':     { en: 'Rotation',  zh: '旋转角度' },
  'af.degrees':      { en: 'degrees',   zh: '度' },
  'af.startCorner':  { en: 'Start corner', zh: '起始角' },
  'af.parameter':    { en: 'Parameter',    zh: '参数' },
  'af.flowRate':     { en: 'Flow rate (mg/mm)', zh: '流量 (mg/mm)' },
  'af.apply':        { en: 'Apply',   zh: '应用' },
  'af.cancel':       { en: 'Cancel',  zh: '取消' },
  'af.selectFirst':  { en: 'Select a pattern first to enable apply.', zh: '请先选择一个图案以启用应用。' },
  'af.previewDot':   { en: 'dot',  zh: '个点' },
  'af.previewDots':  { en: 'dots', zh: '个点' },
  'af.previewLine':  { en: 'line',  zh: '条线' },
  'af.previewLines': { en: 'lines', zh: '条线' },

  // ── Contour Fill panel ────────────────────────────────────────────────────
  'cf.title':          { en: 'Contour Fill',       zh: '轮廓填充' },
  'cf.editTitle':      { en: 'Edit Contour Fill',  zh: '编辑轮廓填充' },
  'cf.fillName':       { en: 'Fill Name',          zh: '填充名称' },
  'cf.fillNamePh':     { en: 'Custom name…',       zh: '自定义名称…' },
  'cf.polyReady':      { en: 'Polygon ready — {n} vertices',                   zh: '多边形已就绪 — {n} 个顶点' },
  'cf.polyStart':      { en: 'Click on the canvas to place polygon vertices',  zh: '点击画布放置多边形顶点' },
  'cf.polyProgress':   { en: '{n} {v} placed — double-click to close',        zh: '{n} 个顶点已放置 — 双击关闭' },
  'cf.vertex':         { en: 'vertex',    zh: '个顶点' },
  'cf.vertices':       { en: 'vertices',  zh: '个顶点' },
  'cf.spacing':        { en: 'Spacing',   zh: '间距' },
  'cf.start':          { en: 'Start', zh: '起始' },
  'cf.outside':        { en: 'Outside', zh: '外侧' },
  'cf.inside':         { en: 'Inside',  zh: '内侧' },
  'cf.fillType':       { en: 'Fill type', zh: '填充类型' },
  'cf.dots':           { en: 'Dots',      zh: '点阵' },
  'cf.lines':          { en: 'Lines',     zh: '线条' },
  'cf.dotSpacing':     { en: 'Dot spacing', zh: '点间距' },
  'cf.zHeight':        { en: 'Z Height',  zh: 'Z 高度' },
  'cf.parameter':      { en: 'Parameter', zh: '参数' },
  'cf.flowRate':       { en: 'Flow rate (mg/mm)', zh: '流量 (mg/mm)' },
  'cf.apply':          { en: 'Apply',     zh: '应用' },
  'cf.cancel':         { en: 'Cancel',    zh: '取消' },
  'cf.selectFirst':    { en: 'Select a pattern first to enable apply.', zh: '请先选择一个图案以启用应用。' },
  'cf.previewLine':    { en: 'line',  zh: '条线' },
  'cf.previewLines':   { en: 'lines', zh: '条线' },
  'cf.previewDot':     { en: 'dot',   zh: '个点' },
  'cf.previewDots':    { en: 'dots',  zh: '个点' },

  // ── History panel ─────────────────────────────────────────────────────────
  'history.savedToDisk': { en: 'Saved to disk',   zh: '已保存到磁盘' },
  'history.title':       { en: 'History',         zh: '历史' },
  'history.noHistory':   { en: 'No history yet',  zh: '暂无历史记录' },
  'history.closeBtn':    { en: 'Close history',   zh: '关闭历史面板' },
  'history.undone':      { en: 'undone',           zh: '已撤销' },
  'history.justNow':     { en: 'just now',         zh: '刚刚' },
  'history.secsAgo':     { en: 's ago',            zh: '秒前' },
  'history.minsAgo':     { en: 'm ago',            zh: '分钟前' },
  'history.hoursAgo':    { en: 'h ago',            zh: '小时前' },

  // ── Settings panel ────────────────────────────────────────────────────────
  'settings.title':    { en: 'Settings',  zh: '设置' },
  'settings.language': { en: 'Language',  zh: '语言' },
  'settings.close':    { en: 'Close',     zh: '关闭' },

  // ── Version selector error dialog ─────────────────────────────────────────
  'version.err.title': { en: 'Parse Error',  zh: '解析错误' },
  'version.err.body':  { en: 'This file could not be parsed with {profile}. Reverting to {previous}.', zh: '无法使用 {profile} 解析此文件，已恢复至 {previous}。' },
  'version.err.ok':    { en: 'OK', zh: '确定' },

  // ── Save error toast ──────────────────────────────────────────────────────
  'error.saveAs': { en: 'Save As…', zh: '另存为…' },
};

export function translate(key: string, lang: Lang, vars?: Record<string, string>): string {
  const entry = dict[key];
  if (!entry) return key;
  let text = entry[lang] ?? entry.en;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(`{${k}}`, v);
    }
  }
  return text;
}
