import { tr, label } from "./i18n";
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, FolderOpen, Layers3, Maximize2 } from "lucide-react";
import { basename, bytes, color, Dialog, parent, percent, weight } from "./shared";
import type { Selection } from "./selection";

type Tile = { label: string; bytes: number; item?: ScanItem; open?: () => void };
type Box = { x: number; y: number; w: number; h: number };
type Placed = { tile: Tile; box: Box; header: boolean };
type MenuTarget = { item: ScanItem; button: HTMLButtonElement; x: number; y: number };

function TileMenu({
  target,
  close,
  openFolder,
  enter,
}: {
  target: MenuTarget;
  close: () => void;
  openFolder: (path: string) => void;
  enter: (path: string) => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const folder = target.item.directory ? target.item.path : parent(target.item.path);
  const dialog = target.button.closest("dialog");
  useLayoutEffect(() => {
    const el = menu.current!;
    const bounds = dialog?.getBoundingClientRect();
    const x = Math.max(
      (bounds?.left ?? 0) + 4,
      Math.min(target.x, (bounds?.right ?? window.innerWidth) - el.offsetWidth - 4),
    );
    const y = Math.max(
      (bounds?.top ?? 0) + 4,
      Math.min(target.y, (bounds?.bottom ?? window.innerHeight) - el.offsetHeight - 4),
    );
    el.style.left = x + "px";
    el.style.top = y + "px";
    el.querySelector("button")!.focus({ preventScroll: true });
    const outside = (e: PointerEvent) => {
      if (!e.composedPath().includes(el)) close();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [target, dialog, close]);
  function dismiss() {
    close();
    target.button.focus({ preventScroll: true });
  }
  // 放大图使用模态 dialog，菜单也必须挂到对应的顶层窗口。
  return createPortal(
    <div
      ref={menu}
      className="tile-menu"
      role="menu"
      aria-label={tr("面积块操作")}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) close();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          dismiss();
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const buttons = Array.from(e.currentTarget.querySelectorAll("button"));
          buttons[
            (buttons.indexOf(document.activeElement as HTMLButtonElement) + 1) % buttons.length
          ]!.focus();
        }
      }}
    >
      <small title={target.item.path}>{basename(target.item.path)}</small>
      <button
        role="menuitem"
        onClick={() => {
          dismiss();
          openFolder(folder);
        }}
      >
        <FolderOpen />
        {target.item.directory ? tr("在资源管理器中打开此文件夹") : tr("打开文件所在文件夹")}
      </button>
      <button
        role="menuitem"
        onClick={() => {
          dismiss();
          enter(folder);
        }}
      >
        <Layers3 />
        {tr("在面积图中浏览此目录")}
      </button>
    </div>,
    dialog ?? document.body,
  );
}
/** 在最长边上按字节权重二分；尺寸和嵌套的坐标均使用同一画布的 CSS 像素。 */
function split(tiles: Tile[], box: Box, place: (tile: Tile, box: Box) => void) {
  const first = tiles[0];
  if (!first) return;
  if (tiles.length === 1) {
    place(first, box);
    return;
  }
  const sum = tiles.reduce((a, t) => a + t.bytes, 0);
  let cut = 1,
    left = first.bytes;
  while (cut < tiles.length - 1) {
    const next = tiles[cut]!.bytes;
    if (Math.abs(sum / 2 - left) <= Math.abs(sum / 2 - left - next)) break;
    left += next;
    cut++;
  }
  const a = { ...box },
    b = { ...box };
  if (box.w >= box.h) {
    a.w *= left / sum;
    b.x += a.w;
    b.w -= a.w;
  } else {
    a.h *= left / sum;
    b.y += a.h;
    b.h -= a.h;
  }
  split(tiles.slice(0, cut), a, place);
  split(tiles.slice(cut), b, place);
}
type Props = {
  selection: Selection;
  metric: SpaceMetric;
  page: MapPage;
  selected: ScanItem;
  detailPath: string;
  select: (s: ScanItem, keepViewport: boolean) => void;
  enter: (path: string) => void;
  openFolder: (path: string) => void;
  turn: (n: number) => void;
};
function Plot({ page, selection, selected, select, enter, turn, metric, openFolder }: Props) {
  const makeTile = (item: ScanItem): Tile => ({
    label: basename(item.path),
    bytes: weight(item, metric),
    item,
  });
  const ref = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const obs = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry!.contentRect;
      setSize({ w, h });
    });
    obs.observe(ref.current!);
    return () => obs.disconnect();
  }, []);
  const tiles = page.tiles.map(makeTile);
  if (page.rest_bytes)
    tiles.push({
      label: tr("其余 {0} 项", page.rest_count),
      bytes: page.rest_bytes,
      open: () => turn(page.map_offset + 48),
    });
  const layout: Placed[] = [];
  split(tiles, { x: 0, y: 0, ...size }, (tile, box) => {
    const dir = tile.item;
    const preview = dir && page.previews[dir.path];
    const header = Boolean(preview?.length && box.w > 115 && box.h > 85);
    layout.push({ tile, box, header });
    if (!header || !preview || !dir) return;
    const children = preview.map(makeTile);
    const rest = tile.bytes - children.reduce((a, t) => a + t.bytes, 0);
    if (rest) children.push({ label: tr("其余内容"), bytes: rest, open: () => enter(dir.path) });
    split(children, { x: box.x + 4, y: box.y + 27, w: box.w - 8, h: box.h - 31 }, (tile, box) =>
      layout.push({ tile, box, header: false }),
    );
  });
  const visible = layout.filter((v) => v.box.w >= 1 && v.box.h >= 1);
  const noArea = parent(selected.path) === page.folder.path && weight(selected, metric) === 0;
  const tooSmall =
    page.tiles.some((i) => i.path === selected.path) &&
    !visible.some((v) => v.tile.item?.path === selected.path);
  return (
    <>
      <div className="treemap" ref={ref} aria-label={tr("空间面积图")}>
        {!tiles.length && (
          <p className="empty">
            {metric === "logical" ? tr("没有正逻辑大小的项目") : tr("没有已计入此目录的磁盘占用")}
          </p>
        )}
        {visible.map(({ tile, box, header }) => {
          const label =
            tile.label +
            " · " +
            bytes(tile.bytes) +
            " · " +
            percent(tile.bytes, weight(page.folder, metric)).toFixed(1) +
            "%";
          return (
            <button
              key={tile.item?.path ?? box.x + ":" + box.y}
              className={"tile" + (header ? " branch" : "")}
              aria-pressed={tile.item ? selection.paths.has(tile.item.path) : undefined}
              data-path={tile.item?.path}
              data-focused={tile.item?.path === selected.path}
              aria-current={tile.item?.path === selected.path || undefined}
              title={label}
              aria-label={label}
              aria-haspopup={tile.item ? "menu" : undefined}
              onContextMenu={(e) => {
                e.preventDefault();
                if (tile.item)
                  setMenu({ item: tile.item, button: e.currentTarget, x: e.clientX, y: e.clientY });
                else setMenu(null);
              }}
              onKeyDown={(e) => {
                if (tile.item && (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) {
                  e.preventDefault();
                  const box = e.currentTarget.getBoundingClientRect();
                  setMenu({
                    item: tile.item,
                    button: e.currentTarget,
                    x: box.left + 6,
                    y: box.top + 6,
                  });
                }
              }}
              style={{
                left: box.x,
                top: box.y,
                width: box.w,
                height: box.h,
                backgroundColor: tile.item ? color(tile.item.kind) : "#647579",
              }}
              onClick={(e) => {
                const item = tile.item;
                if (!item) {
                  tile.open?.();
                  return;
                }
                const path = parent(item.path);
                const order: SelectionOrder = { kind: "directory", path, query: "", metric };
                select(item, e.ctrlKey || e.metaKey || e.shiftKey);
                selection.pick(
                  item,
                  {
                    key: JSON.stringify(order),
                    rows: path === page.folder.path ? page.tiles : page.previews[path]!,
                    order,
                  },
                  e,
                );
              }}
              onDoubleClick={(e) => {
                if (tile.item?.directory && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                  selection.open(tile.item);
                  enter(tile.item.path);
                }
              }}
            >
              {box.w > 32 && box.h > 21 && <strong>{tile.label}</strong>}
              {!header && box.w > 55 && box.h > 42 && <small>{bytes(tile.bytes)}</small>}
            </button>
          );
        })}
        {menu && <TileMenu target={menu} close={closeMenu} openFolder={openFolder} enter={enter} />}
      </div>
      {(noArea || tooSmall) && (
        <p className="map-linked-note" role="status">
          <b>{basename(selected.path)}</b> ·{" "}
          {noArea
            ? metric === "logical"
              ? tr("逻辑大小为零，没有对应面积。")
              : selected.disk.unknown
                ? tr("磁盘占用未完整核实，没有已计入的面积。")
                : tr("此路径的计入占用为零，没有对应面积。")
            : tr("色块小于当前视图的一个像素。")}
        </p>
      )}
    </>
  );
}
export function MapView({
  toolbar,
  full,
  setFull,
  switchMetric,
  ...props
}: Props & {
  toolbar: ReactNode;
  full: boolean;
  setFull: (open: boolean) => void;
  switchMetric: (metric: SpaceMetric) => void;
}) {
  const { page, turn } = props;
  const switcher = (
    <div className="space-switch" role="group" aria-label={tr("面积计算方式")}>
      {(["logical", "allocated"] as const).map((key) => (
        <button key={key} aria-pressed={key === props.metric} onClick={() => switchMetric(key)}>
          {key === "logical" ? tr("逻辑大小") : tr("磁盘占用")}
        </button>
      ))}
    </div>
  );
  const legend = [
    ...new Set([...page.tiles, ...Object.values(page.previews).flat()].map((i) => i.kind)),
  ];
  const controls = (
    <div className="map-foot">
      <div className="legend">
        {legend.map((k) => (
          <span key={k}>
            <i style={{ background: color(k) }} />
            {label(k)}
          </span>
        ))}
      </div>
      {page.map_offset > 0 && (
        <button
          aria-label={tr("上一组面积块")}
          onClick={() => turn(Math.max(0, page.map_offset - 48))}
        >
          <ChevronLeft />
        </button>
      )}
      {page.rest_bytes > 0 && (
        <button onClick={() => turn(page.map_offset + 48)}>
          {tr("其余 ")}
          <ChevronRight />
        </button>
      )}
    </div>
  );
  return (
    <section className="card map-card">
      <div className="panel-title">
        <h2 title={page.folder.path}>
          <Layers3 />
          {tr("空间分布")}
          <small className="map-total">{bytes(weight(page.folder, props.metric))}</small>
        </h2>
        <div className="map-actions">
          {switcher}
          <button
            className="icon"
            title={tr("放大面积图")}
            aria-label={tr("放大面积图")}
            onClick={() => setFull(true)}
          >
            <Maximize2 />
          </button>
        </div>
      </div>
      {props.detailPath !== page.folder.path && (
        <p className="map-folder" title={page.folder.path}>
          {tr("图示目录 · {0}", basename(page.folder.path))}
        </p>
      )}
      <Plot {...props} />
      {controls}
      {props.metric === "allocated" && (
        <p className="disk-note">
          {tr("硬链接只归入首次扫描的路径。")}
          {page.folder.disk.unknown > 0 &&
            tr("有 {0} 个文件的占用未知。", page.folder.disk.unknown)}
        </p>
      )}
      {full && (
        <Dialog title={tr("空间分布")} close={() => setFull(false)}>
          <div className="large-map">
            {toolbar}
            {switcher}
            <Plot {...props} />
            {controls}
            <p className="muted">{props.selected.path}</p>
          </div>
        </Dialog>
      )}
    </section>
  );
}
