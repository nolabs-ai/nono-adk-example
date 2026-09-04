import assert from "node:assert/strict";
import test from "node:test";

import { evaluateArithmetic, fetchUrlContent, listFolderContents } from "../src/tools.js";

test("evaluates supported arithmetic without eval", () => {
  assert.equal(evaluateArithmetic("2 + 2 * 10"), 22);
  assert.equal(evaluateArithmetic("(3 ** 4) / 9"), 9);
  assert.equal(evaluateArithmetic("-2 ** 2"), -4);
  assert.equal(evaluateArithmetic("7 // 2"), 3);
});

test("rejects executable and malformed expressions", () => {
  assert.throws(() => evaluateArithmetic("process.exit()"));
  assert.throws(() => evaluateArithmetic("2 +"));
  assert.throws(() => evaluateArithmetic("1 / 0"));
});

test("lists a directory and reports missing paths", async () => {
  const result = await listFolderContents(".");
  assert.equal(result.status, "ok");
  if (result.status === "ok") assert.ok(result.entries.some((entry) => entry.name === "package.json"));

  const missing = await listFolderContents("./definitely-not-a-real-directory");
  assert.equal(missing.status, "error");
});

test("rejects non-http URLs and embedded credentials", async () => {
  assert.equal((await fetchUrlContent("not a URL")).status, "error");
  assert.equal((await fetchUrlContent("file:///etc/passwd")).status, "error");
  assert.equal((await fetchUrlContent("https://user:password@example.com")).status, "error");
});

test(
  "surfaces filesystem and network policy denials from inside nono",
  { skip: !process.env.NONO_CAP_FILE },
  async () => {
    const files = await listFolderContents("../assistant");
    assert.equal(files.status, "error");
    assert.equal("sandbox" in files ? files.sandbox : undefined, "nono");

    const network = await fetchUrlContent("https://example.com");
    assert.equal(network.status, "error");
    assert.equal(
      "sandbox" in network ? network.sandbox : undefined,
      "nono",
      JSON.stringify(network),
    );

    const allowed = await fetchUrlContent("https://google.com");
    assert.equal(allowed.status, "ok", JSON.stringify(allowed));
  },
);
