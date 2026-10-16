import { Download, FileText, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { completedName, DOCUMENT_ORIGIN, downloadBlob, MAX_DOCUMENT_BYTES, toDocScan } from '../documents/common';
import { ProposalList } from '../components/ProposalList';
import { Button, Card, EmptyState, Notice, SectionTitle } from '../components/ui';
import { useApp } from '../hooks/useApp';
import { toFillInstructions, useProposals } from '../hooks/useProposals';

interface LoadedDoc {
  name: string;
  type: 'docx' | 'pdf';
  bytes: ArrayBuffer;
  idToName: Map<string, string>;
}

export function DocumentsTab() {
  const app = useApp();
  const { proposals, info, run, update, refreshForKey, reset } = useProposals();
  const [doc, setDoc] = useState<LoadedDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File | undefined) => {
    setError(null);
    setDone(null);
    reset();
    setDoc(null);
    if (!file) return;
    const lower = file.name.toLowerCase();
    const type = lower.endsWith('.docx') ? 'docx' : lower.endsWith('.pdf') ? 'pdf' : null;
    if (!type) return setError('Only .docx templates and fillable .pdf forms are supported.');
    if (file.size > MAX_DOCUMENT_BYTES) return setError('File is larger than 10 MB.');
    setBusy(true);
    try {
      const bytes = await file.arrayBuffer();
      // Parse locally. The document body never leaves this browser.
      // Document libraries are loaded on demand to keep the side panel light.
      const raw = type === 'docx' ? (await import('../documents/docx')).readDocxFields(bytes.slice(0)) : await (await import('../documents/pdf')).readPdfFields(bytes.slice(0));
      if (raw.length === 0) {
        setError(
          type === 'docx'
            ? 'No {{placeholders}} found. Add tags such as {{full_name}} to the template. Blank lines in Word documents cannot be detected automatically.'
            : 'This PDF has no interactive form fields. Scanned or flattened PDFs are not supported.',
        );
        return;
      }
      const { scan, idToName } = toDocScan(raw);
      setDoc({ name: file.name, type, bytes, idToName });
      await run(scan, app.facts, app.lockedKeys, app.provider, DOCUMENT_ORIGIN);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read this document');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const generate = async () => {
    if (!doc) return;
    setError(null);
    const fills = toFillInstructions(proposals);
    const values = new Map<string, string>();
    for (const f of fills) {
      const name = doc.idToName.get(f.fieldId);
      if (name && typeof f.value === 'string') values.set(name, f.value);
    }
    if (values.size === 0) return setError('Approve at least one field first.');
    setBusy(true);
    try {
      let blob: Blob;
      let note = '';
      if (doc.type === 'docx') blob = (await import('../documents/docx')).fillDocx(doc.bytes.slice(0), values);
      else {
        const res = await (await import('../documents/pdf')).fillPdf(doc.bytes.slice(0), values);
        blob = res.blob;
        if (res.failed.length) note = ` ${res.failed.length} field(s) could not be written.`;
      }
      downloadBlob(blob, completedName(doc.name));
      setDone(`Completed copy created with ${values.size} field(s).${note} The original file was not changed and nothing was uploaded.`);
      await app.record({ type: 'document', filled: values.size });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the completed document');
    } finally {
      setBusy(false);
    }
  };

  const fillCount = toFillInstructions(proposals).length;

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <SectionTitle>Fill a template locally</SectionTitle>
        <p className="text-xs text-muted">
          Supports .docx templates with {'{{placeholder}}'} tags and PDFs with interactive form fields. Only placeholder / field names are sent for mapping, never the
          document content. Files are not stored.
        </p>
        <input ref={inputRef} type="file" accept=".docx,.pdf" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
        <Button className="mt-3 w-full" icon={Upload} loading={busy && !doc} onClick={() => inputRef.current?.click()}>
          Choose DOCX or PDF
        </Button>
      </Card>

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {done ? <Notice tone="ok" title="Download ready">{done}</Notice> : null}
      {info && info.source !== 'gemma' && info.source !== 'specialist' ? (
        <Notice tone="warn" title={info.source === 'mock' ? 'MOCK MODE' : 'Gemma unavailable: rule-based fallback'}>
          {info.error ? `${info.error} ` : ''}Field names were matched with deterministic rules, not AI.
        </Notice>
      ) : null}

      {doc ? (
        <>
          <div className="flex items-center gap-2 text-xs text-muted">
            <FileText className="size-3.5" aria-hidden />
            <span className="truncate">{doc.name}</span>
            <span>· {proposals.length} fields</span>
          </div>
          <ProposalList proposals={proposals} update={update} refreshForKey={refreshForKey} domain={DOCUMENT_ORIGIN} provenance="document_approved" />
          <div className="sticky bottom-0 -mx-3 border-t border-line bg-bg/95 px-3 py-2.5 backdrop-blur">
            <Button className="w-full" variant="primary" icon={Download} loading={busy} disabled={fillCount === 0} onClick={generate}>
              Download completed copy ({fillCount})
            </Button>
          </div>
        </>
      ) : !error ? (
        <EmptyState icon={FileText} title="No template loaded">
          Try demo/example-template.docx or demo/example-fillable.pdf from the repository.
        </EmptyState>
      ) : null}
    </div>
  );
}
