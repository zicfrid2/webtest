import { TARGET_W, TARGET_H } from "./constants.js";

export function drawBaseImage(state, dom) {
  const { canvas, ctx } = dom;

  canvas.srcCanvas.width = TARGET_W;
  canvas.srcCanvas.height = TARGET_H;
  ctx.srcCtx.clearRect(0, 0, TARGET_W, TARGET_H);
  ctx.srcCtx.drawImage(state.sourceImageBitmap, 0, 0, TARGET_W, TARGET_H);

  canvas.originalCanvas.width = TARGET_W;
  canvas.originalCanvas.height = TARGET_H;
  ctx.originalCtx.clearRect(0, 0, TARGET_W, TARGET_H);
  ctx.originalCtx.drawImage(canvas.srcCanvas, 0, 0);

  canvas.workCanvas.width = TARGET_W;
  canvas.workCanvas.height = TARGET_H;
  ctx.workCtx.clearRect(0, 0, TARGET_W, TARGET_H);
  ctx.workCtx.drawImage(canvas.srcCanvas, 0, 0);

  for (const key of ["maskCanvas", "tempCanvas", "tempCanvas2", "tempCanvas3", "regionCanvas", "regionCanvas2"]) {
    canvas[key].width = TARGET_W;
    canvas[key].height = TARGET_H;
    dom.ctx[key.replace("Canvas", "Ctx")]?.clearRect?.(0, 0, TARGET_W, TARGET_H);
  }
}
