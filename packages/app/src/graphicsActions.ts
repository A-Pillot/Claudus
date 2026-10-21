/**
 * SHARK's Graphics / Add menu and graphic deletion. Elements are added to (or removed from) the current
 * template, so these go through the same `applyTemplate` as the template editor: a built-in template is
 * copied to a custom slot first, so the original stays available.
 */
import { buildElement, getTemplate, hasTemplate, isCustomTemplate, nextFreeSlot, type ElementOption, type GraphicElement, type Template } from '@claudus/core';
import { useApp } from './store';

function currentTemplate(): Template | undefined {
  const { model, end } = useApp.getState();
  const data = model[end];
  return data && hasTemplate(data.templateSlot) ? getTemplate(data.templateSlot) : undefined;
}

/** Replace the current template's graphics, copying a built-in template to a custom slot. */
function changeGraphics(f: (g: GraphicElement[]) => GraphicElement[]): void {
  const base = currentTemplate();
  if (!base) return;
  const t: Template = JSON.parse(JSON.stringify(base));
  if (!isCustomTemplate(t.slot)) {
    t.slot = nextFreeSlot();
    t.label = `${t.label} (custom)`;
  }
  t.source = 'custom';
  t.graphics = f(t.graphics);
  const { art, setArt, applyTemplate } = useApp.getState();
  applyTemplate(t);
  setArt(art); // adding graphics should not move the suspension
}

export function addGraphic(g: GraphicElement): void {
  changeGraphics((list) => [...list, g]);
  useApp.getState().selectGraphic(null);
}

export function deleteGraphic(index: number): void {
  changeGraphics((list) => list.filter((_, i) => i !== index));
}

/** Begin an add: the next point clicks in the 3D view (or the point table) are the picks. */
export function startAdd(option: ElementOption): void {
  const s = useApp.getState();
  s.select(null);
  s.selectGraphic(null);
  s.setAddMode({ option, params: option.params.map((p) => p.def), picked: [] });
  if (option.points === 0) finishAdd();
}

export function cancelAdd(): void {
  // Only when an add is under way: an update on every Escape would re-render open dialogs mid-keypress.
  if (useApp.getState().addMode) useApp.getState().setAddMode(null);
}

function finishAdd(): void {
  const a = useApp.getState().addMode;
  if (!a) return;
  useApp.getState().setAddMode(null);
  addGraphic(buildElement(a.option, a.picked, a.params));
}

/** A point was clicked while adding: record it, and add the element once the last pick is in. */
export function pickPoint(no: number): void {
  const s = useApp.getState();
  const a = s.addMode;
  if (!a) return;
  const picked = [...a.picked, no];
  s.setAddMode({ ...a, picked });
  if (picked.length >= a.option.points) finishAdd();
}
