import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { converter, interpolate } from "culori";
import { File, ready } from "h5wasm/node";
import { PNG } from "pngjs";

const [input, output, profile = new URL("./t2-c.json", import.meta.url)] = process.argv.slice(2);
if (!input || !output) {
  throw new Error("Usage: npm run build -- <input.nc> <output directory> [profile.json]");
}
const config = JSON.parse(await readFile(profile, "utf8"));
await ready;
const source = new File(resolve(input).replaceAll("\\", "/"), "r");

try {
  const dataset = source.get(config.variable);
  const x = source.get("x").value;
  const y = source.get("y").value;
  const times = readTimes(source.get("time"));
  const [hours, height, width] = dataset.shape;
  if (dataset.shape.length !== 3 || hours !== times.length || width !== x.length || height !== y.length) {
    throw new Error(`Expected ${config.variable} on a (time, y, x) grid.`);
  }
  const grid = readGrid(source, x, y);
  const units = dataset.attrs.units.value;
  const fillValue = dataset.attrs._FillValue?.value?.[0];
  const [min, max] = config.range;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
    throw new Error("The display range must have a finite minimum below its maximum.");
  }
  const rampSize = 4096;
  const ramp = interpolate(config.colors, config.interpolation);
  const toRgb = converter("rgb");
  const palette = Array.from({ length: rampSize }, (_, index) => {
    const { r, g, b } = toRgb(ramp(index / (rampSize - 1)));
    return [r, g, b].map(channel => Math.round(Math.min(1, Math.max(0, channel)) * 255));
  });
  const frames = [];
  await mkdir(join(output, "frames"), { recursive: true });

  for (const [index, timestamp] of times.entries()) {
    const values = dataset.slice([[index, index + 1], [], []]);
    if (values.length !== width * height) {
      throw new Error(`Invalid grid size at ${timestamp}.`);
    }
    const image = new PNG({ width, height });
    let noData = 0;
    for (let cell = 0; cell < values.length; cell++) {
      const value = values[cell];
      if (!Number.isFinite(value) || value === fillValue) {
        noData++;
        continue;
      }
      const fraction = Math.min(1, Math.max(0, (value - min) / (max - min)));
      const [red, green, blue] = palette[Math.round(fraction * (rampSize - 1))];
      image.data.set([red, green, blue, 255], 4 * cell);
    }
    const url = `frames/${String(index).padStart(3, "0")}.png`;
    await writeFile(join(output, url), PNG.sync.write(image, { colorType: 6 }));
    frames.push({ timestamp, url, noData });
  }

  const hash = createHash("sha256");
  for await (const chunk of createReadStream(input)) hash.update(chunk);
  const manifest = {
    version: 1,
    source: { filename: basename(input), sha256: hash.digest("hex") },
    variable: config.variable, title: config.title, units,
    grid: { ...grid, width, height },
    style: { range: config.range, colors: config.colors, interpolation: config.interpolation },
    frames,
  };
  await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Exported ${frames.length} ${width}×${height} frames for ${config.variable}.`);
} finally {
  source.close();
}

function readGrid(file, x, y) {
  const spatialRef = file.get("spatial_ref");
  const wkt = String(spatialRef.attrs.crs_wkt.value);
  if (!/ID\["EPSG",3857\]\]\s*$/.test(wkt)) throw new Error("Expected EPSG:3857 in the grid WKT.");
  const dx = x[1] - x[0];
  const dy = y[1] - y[0];
  const regular = (axis, step) => axis.every((value, i) => Math.abs(value - (axis[0] + i * step)) < 1e-5);
  if (!(dx > 0 && dy < 0) || !regular(x, dx) || !regular(y, dy)) {
    throw new Error("Expected a regular, north-up grid with pixel-centre axes.");
  }
  const left = x[0] - dx / 2;
  const top = y[0] - dy / 2;
  return {
    crs: "EPSG:3857",
    bounds: [left, top + y.length * dy, left + x.length * dx, top],
    geoTransform: [left, dx, 0, top, 0, dy],
  };
}

function readTimes(time) {
  const units = time.attrs.units.value;
  const calendar = time.attrs.calendar.value;
  const match = /^(seconds|minutes|hours|days) since (\d{4}-\d\d-\d\d)(?:[ T](\d\d:\d\d(?::\d\d)?))?(?:\s*Z)?$/.exec(units);
  if (!match || !["gregorian", "proleptic_gregorian", "standard"].includes(calendar)) {
    throw new Error(`Unsupported CF time axis: ${units} (${calendar}).`);
  }
  const base = Date.parse(`${match[2]}T${match[3] ?? "00:00:00"}Z`);
  const scale = { seconds: 1000, minutes: 60000, hours: 3600000, days: 86400000 }[match[1]];
  const values = Array.from(time.value, value => base + Number(value) * scale);
  if (!values.length || values.some((value, i) => !Number.isFinite(value) || (i > 0 && value - values[i - 1] !== 3600000))) {
    throw new Error("Expected strictly hourly valid timestamps.");
  }
  return values.map(value => new Date(value).toISOString());
}
