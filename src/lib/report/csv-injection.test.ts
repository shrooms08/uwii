import assert from "node:assert/strict";
import { test } from "node:test";
import { csvField } from "./csv";

test("csvField neutralises formula cells (= + - @ tab CR) with a leading single quote (M1)", () => {
  assert.equal(csvField("=HYPERLINK(\"https://evil.example\",\"x\")"), `"'=HYPERLINK(""https://evil.example"",""x"")"`);
  assert.equal(csvField("+1+1"), "'+1+1");
  assert.equal(csvField("-2+3"), "'-2+3");
  assert.equal(csvField("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvField("\tcmd"), "'\tcmd");
  assert.equal(csvField("\r=1"), `"'\r=1"`);
  // Plain decimal numbers (negative gains, quantities) stay numeric; ordinary text is untouched.
  assert.equal(csvField("-0.000127605"), "-0.000127605");
  assert.equal(csvField("-12"), "-12");
  assert.equal(csvField(-3.5), "-3.5");
  assert.equal(csvField("NEAR"), "NEAR");
  assert.equal(csvField("a,b"), `"a,b"`);
  assert.equal(csvField(null), "");
});
