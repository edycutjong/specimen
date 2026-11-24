import { runS1 } from "./s1";

const el = document.getElementById("result")!;
runS1()
  .then((report) => {
    el.textContent = JSON.stringify(report, null, 2);
    el.dataset.status = report.status;
  })
  .catch((err: unknown) => {
    el.textContent = String(err instanceof Error ? err.stack : err);
    el.dataset.status = "ERROR";
  });
