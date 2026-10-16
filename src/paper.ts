export async function resolvePDF(item: Zotero.Item): Promise<Zotero.Item> {
  if (item.isPDFAttachment()) {
    if (await item.getFilePathAsync()) return item;
    throw new Error(
      "The selected PDF is not downloaded. Open it in Zotero to download it, then try again.",
    );
  }
  if (!item.isRegularItem())
    throw new Error("Select a paper or PDF attachment, rather than a note.");
  const candidates = await item.getBestAttachments();
  // Some best-attachment lists prefer an HTML snapshot; include all child PDFs.
  const children = await Zotero.Items.getAsync(item.getAttachments());
  const attachments = [...candidates, ...children];
  let hasPDF = false;
  for (const attachment of attachments) {
    if (!attachment.isPDFAttachment()) continue;
    hasPDF = true;
    if (await attachment.getFilePathAsync()) return attachment;
  }
  throw new Error(
    hasPDF
      ? "This paper's PDF is not downloaded. Open it in Zotero to download it, then try again."
      : "This paper has no PDF attachment. Attach a PDF first.",
  );
}

export async function extractPaper(item: Zotero.Item): Promise<string> {
  const attachment = await resolvePDF(item);
  // null explicitly extracts all pages, independent of Zotero's indexing limit.
  const result = await Zotero.PDFWorker.getFullText(attachment.id, null, true);
  if (typeof result?.text !== "string")
    throw new Error("Zotero could not extract text from this PDF.");
  return result.text;
}
