import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { loadImage } from "@napi-rs/canvas";
import { badgeFor, INITIAL_LAYOUT, effectiveElements, jobInputSchema, substitute, type InputRow, type JobInput } from "../lib/certificates/model";
import { matchRecipient } from "../lib/certificates/matching";
import { renderPng } from "../lib/certificates/node-render";
import { certificateMail } from "../lib/certificates/email";
import { parseAttendeeFile } from "../lib/certificates/import-file";
import { Workbook } from "exceljs";
import { replaceVariable, resolveColumn } from "../lib/certificates/columns";

const users = [{ id: "user-one", email: "alex@example.test", username: "alex" }, { id: "user-two", email: "sam@example.test", username: "sam" }];
const row: InputRow = { values: { name: "Alex Morgan", course: "Campus Leadership", email: "alex@example.test" }, overrides: {} };
const input: JobInput = { title: "Leadership", layout: INITIAL_LAYOUT, headers: ["name", "course", "email"], rows: [row], columnMapping: { email: "email" }, requestedActions: { archive: true, email: true, internalDelivery: true }, emailTemplate: { subject: "Your {{course}} certificate", text: "Hi {{name}}" }, allowDistinctAwards: false };

test("all badge boundaries include internal and external totals", () => {
  assert.deepEqual([0, 1, 2, 3, 5, 6, 20].map(badgeFor), ["None", "Beginner", "Beginner", "Intermediate", "Intermediate", "Expert", "Expert"]);
});
test("CSV preserves quoted commas, Unicode and leading zeros", async () => {
  const csv = new File(['name,email,course\n"Priya, Patel",priya@example.test,00123\nZoë,zoe@example.test,Design'], "attendees.csv", { type: "text/csv" });
  const parsed = await parseAttendeeFile(csv);
  assert.equal(parsed.rows[0].values.name, "Priya, Patel"); assert.equal(parsed.rows[0].values.course, "00123"); assert.equal(parsed.rows[1].values.name, "Zoë");
});
test("import preserves values under blank/duplicate headers and ignores empty columns", async () => {
  const parsed = await parseAttendeeFile(new File(["Full Name,,Name,Name,,\nPriya Patel,00123,Alex,Sam,,"], "attendees.csv"));
  assert.deepEqual(parsed.headers, ["Full Name", "Column 2", "Name", "Name (2)"]);
  assert.deepEqual(parsed.rows[0].values, { "Full Name": "Priya Patel", "Column 2": "00123", Name: "Alex", "Name (2)": "Sam" });
  assert.equal(parsed.warnings.length, 2);
  assert.equal(parsed.fileName, "attendees.csv");
});
test("Excel delimiter directives and title rows import actual attendees", async () => {
  const parsed = await parseAttendeeFile(new File(["\uFEFFsep=;\r\nWorkshop attendees;;\r\nFull Name;Email Address;Event Name\r\nPriya Patel;priya@example.test;Design"], "attendees.csv"));
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].values["Full Name"], "Priya Patel");
  assert.equal(parsed.warnings.length, 1);
  assert.equal(substitute("{{name}} · {{course}} · {{email}}", parsed.rows[0].values), "Priya Patel · Design · priya@example.test");
  assert.equal(effectiveElements(INITIAL_LAYOUT, parsed.rows[0])[2].text, "Priya Patel");
  assert.equal(jobInputSchema.safeParse({ ...input, headers: parsed.headers, rows: parsed.rows, columnMapping: { email: "Email Address" } }).success, true);
});
test("column matching ignores casing/separators but leaves ambiguous aliases for manual selection", () => {
  assert.equal(resolveColumn("name", ["FULL_NAME"]), "FULL_NAME");
  assert.equal(resolveColumn("email", ["E-mail"]), "E-mail");
  assert.equal(resolveColumn("name", ["Full Name", "Participant Name"]), undefined);
  assert.equal(resolveColumn("Name", ["Name", "Full Name"]), "Name");
  assert.equal(resolveColumn("name", ["Nickname"]), undefined);
  assert.equal(replaceVariable("Hi {{ name }} / {{course}}", "name", "Full Name"), "Hi {{Full Name}} / {{course}}");
});
test("XLSX reads the first worksheet and rejects empty imports", async () => {
  const book = new Workbook(); const sheet = book.addWorksheet("People"); sheet.addRows([["name", "email"], ["Alex", "alex@example.test"]]);
  sheet.getCell("ZZ10").font = { bold: true };
  const bytes = await book.xlsx.writeBuffer();
  const parsed = await parseAttendeeFile(new File([new Uint8Array(bytes)], "attendees.xlsx"));
  assert.equal(parsed.rows[0].values.name, "Alex");
  assert.deepEqual(parsed.headers, ["name", "email"]);
  await assert.rejects(() => parseAttendeeFile(new File(["name,email\n"], "empty.csv")), /1 and 50,000/);
});
test("large CSV imports all 50,000 rows beyond 8 MB, with chunk progress and intact Unicode/quoted lines", async () => {
  const note = `Workshop, Zoë\n${"x".repeat(175)}`;
  const file = new File(["name,email,course,note\n", ...Array.from({ length: 50_000 }, (_, i) => `Attendee ${i + 1},person${i + 1}@example.test,Design,"${note}"\n`)], "large.csv");
  assert.ok(file.size > 8 * 1024 * 1024);
  const progress: number[] = [];
  const parsed = await parseAttendeeFile(file, value => progress.push(value.percent));
  assert.equal(parsed.rows.length, 50_000);
  for (const [index, attendee] of parsed.rows.entries()) {
    assert.equal(attendee.values.name, `Attendee ${index + 1}`);
    assert.equal(attendee.values.note, note);
  }
  assert.ok(progress.length > 2);
  assert.equal(progress.at(-1), 100);
  assert.deepEqual(progress, [...progress].sort((a, b) => a - b));
});
test("large CSV limits report errors without silently truncating rows", async () => {
  await assert.rejects(() => parseAttendeeFile(new File(["name,email\n", "Alex,alex@example.test\n".repeat(50_001)], "too-many.csv")), /50,000/);
  await assert.rejects(() => parseAttendeeFile({ name: "too-big.csv", size: 50 * 1024 * 1024 + 1 } as File), /50 MB/);
  await assert.rejects(() => parseAttendeeFile(new File([`name,email\n${"a".repeat(2001)},a@example.test`], "long-cell.csv")), /2,000 characters/);
});
test("email and username matching are exact and case-insensitive", () => {
  assert.equal(matchRecipient(users, " ALEX@example.test ", "ALEX").userId, "user-one");
  assert.equal(matchRecipient(users, "", "SAM").email, "sam@example.test");
  assert.equal(matchRecipient(users, "", "al").status, "unmatched");
});
test("unmatched addresses retain email delivery, conflicts never award an account", () => {
  const unmatched = matchRecipient(users, "visitor@example.test", "");
  assert.equal(unmatched.status, "unmatched"); assert.equal(unmatched.email, "visitor@example.test"); assert.equal(unmatched.userId, undefined);
  const conflict = matchRecipient(users, "alex@example.test", "sam");
  assert.equal(conflict.status, "conflict"); assert.equal(conflict.userId, undefined); assert.equal(conflict.email, "alex@example.test");
  assert.equal(matchRecipient(users, "visitor@example.test", "alex").status, "conflict");
  assert.equal(matchRecipient(users, "bad address", "alex").status, "invalid");
  assert.equal(matchRecipient([...users, { id: "duplicate", email: "another@example.test", username: "alex" }], "", "alex").status, "ambiguous");
});
test("row override changes only its targeted layer and does not mutate template", () => {
  const overridden = { ...row, overrides: { "text-2": { fontSize: 32, text: "Congratulations {{name}}" } } };
  assert.equal(effectiveElements(INITIAL_LAYOUT, overridden)[2].fontSize, 32);
  assert.equal(effectiveElements(INITIAL_LAYOUT, overridden)[2].text, "Congratulations Alex Morgan");
  assert.equal(effectiveElements(INITIAL_LAYOUT, row)[2].fontSize, 64);
  assert.equal(INITIAL_LAYOUT.elements[2].text, "{{name}}");
});
test("job validation rejects unknown placeholders, bad mappings, huge canvases and orphaned overrides", () => {
  assert.equal(jobInputSchema.safeParse(input).success, true);
  assert.equal(jobInputSchema.safeParse({ ...input, headers: ["name", "course", "course"] }).success, false);
  assert.equal(jobInputSchema.safeParse({ ...input, columnMapping: { email: "missing" } }).success, false);
  assert.equal(jobInputSchema.safeParse({ ...input, layout: { ...INITIAL_LAYOUT, width: 4096, height: 4096 } }).success, false);
  assert.equal(jobInputSchema.safeParse({ ...input, rows: [{ ...row, overrides: { "not-a-layer": { fontSize: 40 } } }] }).success, false);
  assert.equal(jobInputSchema.safeParse({ ...input, emailTemplate: { subject: "Hello {{missing}}", text: "Hello" } }).success, false);
  assert.equal(jobInputSchema.safeParse({ ...input, requestedActions: { archive: true, email: false, internalDelivery: false }, emailTemplate: { subject: "Hello {{missing}}", text: "Hello" } }).success, true);
  assert.equal(jobInputSchema.safeParse({ ...input, requestedActions: { archive: false, email: false, internalDelivery: false } }).success, false);
});
test("placeholder values are literal, not evaluated or recursively expanded", () => {
  assert.equal(substitute("Hello {{ name }}", { name: "{{course}} $&" }), "Hello {{course}} $&");
  assert.equal(substitute("{{constructor}}", {}), "");
});
test("{{event}} is usable in the email subject/message once an event is linked", () => {
  assert.equal(jobInputSchema.safeParse({ ...input, emailTemplate: { subject: "Certificate for {{event}}", text: "Hi {{name}}" } }).success, false);
  assert.equal(jobInputSchema.safeParse({ ...input, eventId: "evt-123", emailTemplate: { subject: "Certificate for {{event}}", text: "Hi {{name}}" } }).success, true);
  assert.equal(substitute("Certificate for {{event}}", { name: "Alex" }, undefined, "Orientation Day"), "Certificate for Orientation Day");
});
test("SMTP content escapes HTML, strips subject newlines, and never attaches the certificate image", () => {
  const job = { ...input, id: "job-test", emailTemplate: { subject: "Hi {{name}}", text: "Hello {{name}}\nYour certificate is ready." } };
  const recipient = { ...row, id: "000001", rowNumber: 1, emailNormalized: "visitor@example.test", values: { name: "<script>\r\nBcc: bad@example.test</script>" } };
  const mail = certificateMail(job, recipient);
  assert.equal(mail.to, "visitor@example.test"); assert.ok(!mail.subject.includes("\n"));
  assert.ok(mail.html.includes("&lt;script&gt;")); assert.ok(!mail.html.includes("<script>"));
  assert.equal(mail.attachments.length, 1);
  assert.ok(!mail.attachments.some(a => /^certificate-/.test(a.filename)));
  assert.ok(mail.html.includes("cid:"));
  assert.ok(mail.html.includes("sign in"));
  assert.equal(mail.messageId, certificateMail(job, recipient).messageId);
});
test("server rendering produces different full-resolution PNGs and a valid ZIP", async () => {
  const first = await renderPng(INITIAL_LAYOUT, row);
  const imported = await parseAttendeeFile(new File(["Full Name,Event Name,Email Address\nAlex Morgan,Campus Leadership,alex@example.test"], "attendees.csv"));
  assert.deepEqual(await renderPng(INITIAL_LAYOUT, imported.rows[0]), first);
  const second = await renderPng(INITIAL_LAYOUT, { values: { ...row.values, name: "Sam Rivera" }, overrides: { "text-2": { fontSize: 36, bold: true, italic: true } } });
  assert.equal(first.subarray(1, 4).toString(), "PNG"); assert.notDeepEqual(first, second);
  const image = await loadImage(first); assert.equal(image.width, 1200); assert.equal(image.height, 850);
  const archive = new JSZip().file("certificate-1.png", first).file("certificate-2.png", second);
  const restored = await JSZip.loadAsync(await archive.generateAsync({ type: "nodebuffer" }));
  assert.equal(Object.keys(restored.files).length, 2); assert.deepEqual(await restored.file("certificate-1.png")!.async("nodebuffer"), first);
});
