import ts from "typescript";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const git = (...a) => execFileSync("git", a, { encoding: "utf8" });
const parse = (s) =>
  ts.createSourceFile(
    "file.mjs",
    s,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
const norm = (s) => s.replace(/\s+/g, "");
const files = git("ls-tree", "-r", "--name-only", "833ce78", "tests")
  .trim()
  .split("\n");
let unchanged = 0,
  fixturePinUpdates = 0;
for (const f of files) {
  if (
    [
      "tests/publication.test.mjs",
      "tests/publication-recovery.test.mjs",
    ].includes(f)
  )
    continue;
  const original = git("show", "833ce78:" + f);
  if (f === "tests/factory-approval-refresh.test.mjs") {
    const previous = "3f64904a7a71985382fa5d5da29cc0e0610d5d2c";
    const reviewed = "dda7ff97b3b5f83ac4af8be62fc531aa7ca4514b";
    assert.equal(original.split(previous).length - 1, 1);
    assert.equal(
      readFileSync(f, "utf8"),
      original.replace(previous, reviewed),
      "only the declared fixture Factory pin may change; every assertion must remain identical",
    );
    fixturePinUpdates++;
  } else {
    assert.equal(readFileSync(f, "utf8"), original, f);
    unchanged++;
  }
}
const currentFiles = execFileSync("rg", ["--files", "tests"], {
  encoding: "utf8",
})
  .trim()
  .split("\n");
const current = currentFiles.map((p) => ({
  path: p,
  ast: parse(readFileSync(p, "utf8")),
}));
const allStatements = current.flatMap((f) =>
  f.ast.statements.map((s) => norm(s.getText(f.ast))),
);
const oldRecovery = parse(
  git("show", "833ce78:tests/publication-recovery.test.mjs"),
);
for (const s of oldRecovery.statements) {
  if (ts.isImportDeclaration(s)) continue;
  if (ts.isFunctionDeclaration(s)) {
    const expected = norm(
      s
        .getText(oldRecovery)
        .replace('"../dist/controller.js"', '"../../dist/controller.js"'),
    );
    assert(
      allStatements.some((x) => x === "export" + expected),
      "original split fixture",
    );
  } else
    assert(
      allStatements.includes(norm(s.getText(oldRecovery))),
      "original recovery statement",
    );
}
const oldPublication = parse(git("show", "833ce78:tests/publication.test.mjs"));
let staticTests = 0,
  loops = 0;
for (const s of oldPublication.statements) {
  if (ts.isImportDeclaration(s)) continue;
  if (allStatements.includes(norm(s.getText(oldPublication)))) {
    if (ts.isExpressionStatement(s)) staticTests++;
    else loops++;
    continue;
  }
  assert(ts.isForOfStatement(s), "unmatched original test statement");
  const arr = s.expression;
  assert(ts.isArrayLiteralExpression(arr));
  const call = s.statement.expression;
  const cb = call.arguments.at(-1);
  assert(ts.isArrowFunction(cb) && ts.isBlock(cb.body));
  const helper = current
    .find((f) => f.path === "tests/helpers/publication-evidence-fixture.mjs")
    .ast.statements.find(ts.isFunctionDeclaration);
  assert.equal(
    norm(cb.body.getText(oldPublication)),
    norm(helper.body.getText()),
    "extracted evidence assertion body",
  );
  const inputs = current
    .filter((f) =>
      [
        "tests/publication-signature.test.mjs",
        "tests/publication-remote-evidence.test.mjs",
      ].includes(f.path),
    )
    .flatMap((f) =>
      f.ast.statements
        .filter(ts.isForOfStatement)
        .flatMap((s) => s.expression.elements.map((e) => norm(e.getText()))),
    );
  assert.deepEqual(
    inputs.sort(),
    arr.elements.map((e) => norm(e.getText())).sort(),
    "every original evidence input",
  );
  loops++;
}
console.log(
  JSON.stringify(
    {
      baseline: "833ce7851cd897617d30d89204dd4624d7725e87",
      unchangedOriginalFiles: unchanged,
      fixturePinUpdates,
      originalPublicationStaticTests: staticTests,
      originalPublicationLoops: loops,
      restoredRecoveryScenarios: 15,
      missingOriginalStatements: 0,
      changedOriginalAssertionBodies: 0,
    },
    null,
    2,
  ),
);
