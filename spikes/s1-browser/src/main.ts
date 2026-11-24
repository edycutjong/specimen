import { runS1 } from "./s1";
import { runS1Real } from "./s1-real";

const el = document.getElementById("result")!;
Promise.all([runS1(), runS1Real()])
  .then(([toy, real]) => {
    el.textContent = JSON.stringify({ toy, real }, null, 2);
    el.dataset.status = toy.status === "PASS" && real.status === "PASS" ? "PASS" : "FAIL";
  })
  .catch((err: unknown) => {
    el.textContent = String(err instanceof Error ? err.stack : err);
    el.dataset.status = "ERROR";
  });
