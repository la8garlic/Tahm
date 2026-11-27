import { locale } from "./i18n";
/** 桌面调用集中在此处，视图只接收带类型的报告和进度。 */
const { invoke, Channel } = window.__TAURI__.core;

/** @returns {Promise<string | null>} */
export const initialFolder = () => invoke("initial_folder");
/** @returns {Promise<string | null>} */
export const chooseFolder = () => invoke("choose_folder", { english: locale() === "en" });
/** @param {string} path @param {(progress: ProgressUpdate) => void} onProgress @returns {Promise<ScanReport | null>} */
export const analyze = (path, onProgress) =>
  invoke("analyze", { path, updates: new Channel(onProgress) });
/** 请求扫描线程在下一个目录项边界停止。 */
export const cancelScan = () => invoke("cancel_scan");
/** @param {string} path */
export const openFolder = (path) => invoke("open_folder", { path });
/** @param {ScanReport} report @returns {Promise<string | null>} */
export const exportReport = (report) =>
  invoke("export_report", { json: JSON.stringify(report, null, 2), english: locale() === "en" });

/** @param {string} path @returns {Promise<string[]>} */
export const directorySample = (path) => invoke("directory_sample", { path });
/** @param {ModelSettings} settings @param {string[]} facts @returns {Promise<Assessment>} */
export const explainDirectory = (settings, facts) =>
  invoke("explain_directory", { settings, facts, english: locale() === "en" });

/** @returns {Promise<[string, string][]>} */
export const locations = () => invoke("locations");
/** @returns {Promise<{path:string,label:string,total:number,free:number}[]>} */
export const volumes = () => invoke("volumes");
/** 按列表筛选与排序定位文件。 @param {number} generation @param {string} path @param {string} query @param {number} offset @param {string | null} focus @param {SpaceMetric} metric @returns {Promise<FolderPage>} */
export const folderPage = (generation, path, query, offset, focus, metric) =>
  invoke("folder_page", { generation, path, query, viewport: { offset, focus, metric } });
/** 加载包含目标色块的面积组。 @param {number} generation @param {string} path @param {number} offset @param {string | null} focus @param {SpaceMetric} metric @returns {Promise<MapPage>} */
export const mapPage = (generation, path, offset, focus, metric) =>
  invoke("map_page", { generation, path, viewport: { offset, focus, metric } });
/** 重新核对清单的磁盘占用和链接计数。 @param {number} generation @param {string[]} paths @param {string} ticket @returns {Promise<ReclaimEstimate>} */
export const estimateReclaim = (generation, paths, ticket) =>
  invoke("estimate_reclaim", { generation, paths, ticket });
/** 停止后台遍历已关闭或已变更的清单。 @param {string} ticket */
export const cancelEstimate = (ticket) => invoke("cancel_estimate", { ticket });
/** 逐项返回批量入单复核结果。 @param {number} generation @param {string[]} paths @returns {Promise<RecycleResult[]>} */
export const checkCandidates = (generation, paths) =>
  invoke("check_candidates", { generation, paths });
/** 按当前快照取跨页选区。 @param {number} generation @param {SelectionOrder} order @param {string} start @param {string} end @returns {Promise<ScanItem[]>} */
export const selectionRange = (generation, order, start, end) =>
  invoke("selection_range", { generation, order, start, end });
/** 复核和 Shell 回收共用一个进度通道。 @param {number} generation @param {string[]} paths @param {(p:RecycleProgress)=>void} onProgress @returns {Promise<RecycleResult[]>} */
export const recycleItems = (generation, paths, onProgress) =>
  invoke("recycle_items", { generation, paths, updates: new Channel(onProgress) });
/** 打开系统回收站以查看或还原文件。 */
export const openBin = () => invoke("open_recycle_bin");
/** @param {number} generation @param {number} before @param {number} minimum @param {string} query @returns {Promise<[number, ScanItem[]]>} */
export const oldFolders = (generation, before, minimum, query) =>
  invoke("old_folders", { generation, before, minimum, query });
/** 在全扫描范围按文件名、扩展名和大小查找。
 * @param {number} generation @param {string} query @param {string|null} extension @param {number} minimum
 * @param {{bytes:number,path:string}|null} after @returns {Promise<[number, ScanItem[]]>} */
export const findFiles = (generation, query, extension, minimum, after) =>
  invoke("find_files", { generation, query, extension, minimum, after });

/** 仅在手动确认后从磁盘读取同尺寸文件进行逐字节比对。
 * @param {number} generation @param {string} path @param {(p:CopyProgress)=>void} onProgress @returns {Promise<CopyReport>} */
export const findCopies = (generation, path, onProgress) =>
  invoke("find_copies", { generation, path, updates: new Channel(onProgress) });
/** 取消当前文件内容比对。 */
export const cancelCopies = () => invoke("cancel_copies");
