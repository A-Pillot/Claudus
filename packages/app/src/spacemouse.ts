/**
 * 3Dconnexion SpaceMouse input for the 3D view.
 *
 * Two ways in, one report parser:
 * - Browser: WebHID (Chrome, Edge, Opera). The user picks the device once; after that it reconnects by itself.
 * - Desktop: the app's native side reads the device through hidapi (src-tauri/src/spacemouse.rs) and forwards
 *   the raw reports as "spacemouse-report" events, because the desktop web views on macOS and Linux have no WebHID.
 *
 * Motion is "object mode", as in 3Dconnexion's own drivers: the model follows the cap. Push sideways to pan,
 * pull or push to zoom, tilt to tip the model over, twist to turn it about the vertical. Roll (tilting left or
 * right) is not used, because the view keeps Z up.
 */
import * as THREE from 'three';
import { create } from 'zustand';
import type { Vec3 } from '@claudus/core';
import { isDesktop } from './desktop';
import { cameraApi, useViewCtl } from './viewCtl';

/** 3Dconnexion's own vendor id; older devices used Logitech's. */
export const VENDOR_3DCONNEXION = 0x256f;
export const VENDOR_LOGITECH = 0x046d;
/** Logitech product ids of 3Dconnexion devices (SpaceMouse Plus to SpaceMouse Pro). */
export const LOGITECH_3DX_PRODUCTS = [0xc603, 0xc605, 0xc606, 0xc621, 0xc623, 0xc625, 0xc626, 0xc627, 0xc628, 0xc629, 0xc62b];

/** Raw axis value of a full deflection. */
const FULL_SCALE = 350;
/** With no report for this long, treat the cap as released (a lost "at rest" report must not leave the view spinning). */
const STALE_MS = 500;

// ---------------------------------------------------------------------------------------------------------------
// Settings

export interface SpaceMouseSettings {
  enabled: boolean;
  /** Overall speed multiplier. */
  speed: number;
  /** Fraction of full deflection ignored around rest (0..0.5). */
  deadZone: number;
  pan: boolean;
  zoom: boolean;
  rotate: boolean;
  invertPan: boolean;
  invertZoom: boolean;
  invertRotate: boolean;
}

export const defaultSpaceMouseSettings: SpaceMouseSettings = {
  enabled: true, speed: 1, deadZone: 0.05, pan: true, zoom: true, rotate: true, invertPan: false, invertZoom: false, invertRotate: false,
};

const KEY = 'claudus.spacemouse';
function readSettings(): SpaceMouseSettings {
  try {
    const t = localStorage.getItem(KEY);
    return { ...defaultSpaceMouseSettings, ...(t ? (JSON.parse(t) as Partial<SpaceMouseSettings>) : {}) };
  } catch {
    return { ...defaultSpaceMouseSettings };
  }
}

export type SpaceMouseSource = 'webhid' | 'native';

interface SpaceMouseStore {
  settings: SpaceMouseSettings;
  setSettings: (p: Partial<SpaceMouseSettings>) => void;
  /** Name of the connected device, or null. */
  device: string | null;
  source: SpaceMouseSource | null;
  /** Last problem (no permission, not supported, ...), shown in the dialog. */
  error: string | null;
}

export const useSpaceMouse = create<SpaceMouseStore>((set, get) => ({
  settings: readSettings(),
  setSettings: (p) => {
    set({ settings: { ...get().settings, ...p } });
    try { localStorage.setItem(KEY, JSON.stringify(get().settings)); } catch { /* storage unavailable */ }
  },
  device: null,
  source: null,
  error: null,
}));

// ---------------------------------------------------------------------------------------------------------------
// Reports

/** Six axes in raw device units: tx, ty, tz, rx, ry, rz. HID axes: X right, Y towards the user, Z down. */
export type Axes = [number, number, number, number, number, number];

export interface ParsedReport {
  translation?: [number, number, number];
  rotation?: [number, number, number];
  /** Button bit mask (bit 0 = first button). */
  buttons?: number;
}

const int16s = (b: Uint8Array, n: number): number[] => {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return Array.from({ length: n }, (_, i) => v.getInt16(i * 2, true));
};

/**
 * Read one input report (without its report id byte). Report 1 is translation, or all six axes on newer
 * devices; report 2 is rotation on older ones; report 3 is the buttons.
 */
export function parseReport(id: number, data: Uint8Array): ParsedReport {
  if (id === 1 && data.length >= 12) {
    const a = int16s(data, 6);
    return { translation: [a[0], a[1], a[2]], rotation: [a[3], a[4], a[5]] };
  }
  if (id === 1 && data.length >= 6) {
    const a = int16s(data, 3);
    return { translation: [a[0], a[1], a[2]] };
  }
  if (id === 2 && data.length >= 6) {
    const a = int16s(data, 3);
    return { rotation: [a[0], a[1], a[2]] };
  }
  if (id === 3) {
    let mask = 0;
    for (let i = 0; i < Math.min(data.length, 4); i++) mask |= data[i] << (8 * i);
    return { buttons: mask >>> 0 };
  }
  return {};
}

// Current input, updated by reports and read every frame by the 3D view.
const input = { axes: [0, 0, 0, 0, 0, 0] as Axes, at: 0, buttons: 0 };

/** Feed one report into the current state (exported for tests). */
export function feedReport(id: number, data: Uint8Array, now = performance.now()): void {
  const r = parseReport(id, data);
  if (r.translation) { input.axes[0] = r.translation[0]; input.axes[1] = r.translation[1]; input.axes[2] = r.translation[2]; input.at = now; }
  if (r.rotation) { input.axes[3] = r.rotation[0]; input.axes[4] = r.rotation[1]; input.axes[5] = r.rotation[2]; input.at = now; }
  if (r.buttons !== undefined) {
    const pressed = r.buttons & ~input.buttons;
    input.buttons = r.buttons;
    if (pressed) onButtons(pressed);
  }
}

/** Buttons: the two-button models' left button is Isometric and right is Fit; the Pro keeps its labelled keys. */
function onButtons(pressed: number): void {
  const cam = cameraApi();
  if (!cam) return;
  if (pressed & 0b1) cam.stdView('iso'); // left button / Menu
  if (pressed & 0b10) cam.fit(); // right button / Fit
  if (pressed & (1 << 2)) cam.stdView('top'); // Pro: T
  if (pressed & (1 << 4)) cam.stdView('right'); // Pro: R
  if (pressed & (1 << 5)) cam.stdView('front'); // Pro: F
}

/** The axes now, scaled to -1..1 with the dead zone taken out, or null when the cap is at rest. */
export function currentAxes(settings: SpaceMouseSettings, now = performance.now()): Axes | null {
  if (!settings.enabled || now - input.at > STALE_MS) return null;
  const dz = Math.min(Math.max(settings.deadZone, 0), 0.5);
  let any = false;
  const out = input.axes.map((raw) => {
    const v = Math.max(-1, Math.min(1, raw / FULL_SCALE));
    const m = Math.abs(v);
    if (m <= dz) return 0;
    any = true;
    return Math.sign(v) * ((m - dz) / (1 - dz));
  }) as Axes;
  return any ? out : null;
}

/** Forget the current input (device gone). */
export function resetInput(): void {
  input.axes = [0, 0, 0, 0, 0, 0];
  input.at = 0;
  input.buttons = 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Camera motion

/** Rates at full deflection and speed 1. */
const PAN_RATE = 0.8; // view distances per second
const ZOOM_RATE = 1.6; // e-folds of distance per second
const ROT_RATE = 1.8; // radians per second

/**
 * Move a camera orbiting a target for one frame of SpaceMouse input. Z is up; right and up are the camera's
 * screen directions in world axes. Returns the new camera position and target.
 */
export function spaceMouseStep(
  axes: Axes, dt: number, position: Vec3, target: Vec3, right: Vec3, up: Vec3, s: SpaceMouseSettings,
): { position: Vec3; target: Vec3 } {
  const pos = new THREE.Vector3(...position);
  const tgt = new THREE.Vector3(...target);
  const r = new THREE.Vector3(...right).normalize();
  const u = new THREE.Vector3(...up).normalize();
  const k = s.speed * dt;
  const [tx, ty, tz, rx, , rz] = axes;
  let offset = pos.clone().sub(tgt);
  const dist = Math.max(offset.length(), 1e-6);

  if (s.rotate && (rx || rz)) {
    const sign = s.invertRotate ? -1 : 1;
    // Twist (about Z down): the model turns the same way, so the camera goes round the other way about world Z.
    offset.applyAxisAngle(new THREE.Vector3(0, 0, 1), sign * rz * ROT_RATE * k);
    // Tilt towards you: the model's top comes towards you, so the camera rises over it.
    const rAfter = r.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), sign * rz * ROT_RATE * k);
    const tilted = offset.clone().applyAxisAngle(rAfter, -sign * rx * ROT_RATE * k);
    // Stop short of looking straight down or up, where Z-up orbiting flips over.
    const n = tilted.clone().normalize();
    if (Math.abs(n.z) < 0.995) offset = tilted;
  }
  if (s.zoom && ty) {
    // Pull the cap towards you: the model comes closer.
    offset.multiplyScalar(Math.exp(-(s.invertZoom ? -1 : 1) * ty * ZOOM_RATE * k));
  }
  if (s.pan && (tx || tz)) {
    // Push right: the model goes right, so the view moves left. Lift (Z is down): the model goes up.
    const sign = s.invertPan ? -1 : 1;
    const move = r.clone().multiplyScalar(-tx).add(u.clone().multiplyScalar(tz)).multiplyScalar(sign * PAN_RATE * dist * k);
    tgt.add(move);
  }
  const out = tgt.clone().add(offset);
  return { position: out.toArray() as Vec3, target: tgt.toArray() as Vec3 };
}

// ---------------------------------------------------------------------------------------------------------------
// Devices

type HidDevice = {
  productName: string;
  opened: boolean;
  open: () => Promise<void>;
  close: () => Promise<void>;
  addEventListener: (t: 'inputreport', f: (e: { reportId: number; data: DataView }) => void) => void;
  removeEventListener: (t: 'inputreport', f: (e: { reportId: number; data: DataView }) => void) => void;
  vendorId: number;
  productId: number;
};
type Hid = {
  getDevices: () => Promise<HidDevice[]>;
  requestDevice: (o: { filters: { vendorId?: number; productId?: number; usagePage?: number; usage?: number }[] }) => Promise<HidDevice[]>;
  addEventListener: (t: 'connect' | 'disconnect', f: (e: { device: HidDevice }) => void) => void;
};

const hid = (): Hid | null => (typeof navigator !== 'undefined' && 'hid' in navigator ? (navigator as unknown as { hid: Hid }).hid : null);

export const HID_FILTERS = [
  { vendorId: VENDOR_3DCONNEXION },
  ...LOGITECH_3DX_PRODUCTS.map((productId) => ({ vendorId: VENDOR_LOGITECH, productId })),
];

const isSpaceMouse = (d: { vendorId: number; productId: number }) =>
  d.vendorId === VENDOR_3DCONNEXION || (d.vendorId === VENDOR_LOGITECH && LOGITECH_3DX_PRODUCTS.includes(d.productId));

/** Whether this build can talk to a SpaceMouse at all. */
export const spaceMouseSupported = (): boolean => isDesktop() || hid() !== null;

let current: HidDevice | null = null;
const onReport = (e: { reportId: number; data: DataView }) =>
  feedReport(e.reportId, new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength));

async function attachHidDevice(d: HidDevice): Promise<void> {
  if (current === d) return;
  if (current) current.removeEventListener('inputreport', onReport);
  if (!d.opened) await d.open();
  d.addEventListener('inputreport', onReport);
  current = d;
  useSpaceMouse.setState({ device: d.productName || 'SpaceMouse', source: 'webhid', error: null });
}

/** Browser: ask for a device (needs a click). Resolves to an error message, or null when connected. */
export async function connectSpaceMouse(): Promise<string | null> {
  const h = hid();
  if (isDesktop()) return 'The desktop app finds the SpaceMouse by itself.';
  if (!h) return 'This browser has no WebHID. Use Chrome, Edge or Opera, or the desktop app.';
  try {
    const [d] = await h.requestDevice({ filters: HID_FILTERS });
    if (!d) return null; // chooser closed
    await attachHidDevice(d);
    return null;
  } catch (e) {
    const msg = `Could not open the SpaceMouse: ${(e as Error).message}`;
    useSpaceMouse.setState({ error: msg });
    return msg;
  }
}

/** Disconnect the browser device (the desktop one stays with the native side). */
export async function disconnectSpaceMouse(): Promise<void> {
  if (!current) return;
  current.removeEventListener('inputreport', onReport);
  try { await current.close(); } catch { /* already gone */ }
  current = null;
  resetInput();
  useSpaceMouse.setState({ device: null, source: null });
}

let started = false;
/** Start listening: reconnect a device the browser already allowed, or start the desktop reader. */
export async function initSpaceMouse(): Promise<void> {
  if (started) return;
  started = true;
  if (isDesktop()) {
    try {
      const { listen } = await import('@tauri-apps/api/event');
      const { invoke } = await import('@tauri-apps/api/core');
      await listen<number[]>('spacemouse-report', (e) => {
        const b = Uint8Array.from(e.payload);
        if (b.length > 1) feedReport(b[0], b.subarray(1));
      });
      await listen<{ connected: boolean; name: string; error: string | null }>('spacemouse-status', (e) => {
        if (!e.payload.connected) resetInput();
        useSpaceMouse.setState({ device: e.payload.connected ? e.payload.name || 'SpaceMouse' : null, source: e.payload.connected ? 'native' : null, error: e.payload.error });
      });
      await invoke('spacemouse_start');
    } catch (e) {
      useSpaceMouse.setState({ error: `SpaceMouse reader did not start: ${(e as Error).message ?? String(e)}` });
    }
    return;
  }
  const h = hid();
  if (!h) return;
  h.addEventListener('connect', (e) => { if (isSpaceMouse(e.device)) void attachHidDevice(e.device).catch(() => undefined); });
  h.addEventListener('disconnect', (e) => { if (e.device === current) { current = null; resetInput(); useSpaceMouse.setState({ device: null, source: null }); } });
  try {
    const known = (await h.getDevices()).find(isSpaceMouse);
    if (known) await attachHidDevice(known);
  } catch { /* not allowed in this frame */ }
}

/** Keep the standard-view tick honest: moving with the SpaceMouse leaves the standard view. */
export const leaveStdView = () => { if (useViewCtl.getState().stdView) useViewCtl.setState({ stdView: null }); };
