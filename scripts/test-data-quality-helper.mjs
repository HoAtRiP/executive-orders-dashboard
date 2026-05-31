import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const helperPath = path.join(__dirname, '../src/dataQuality.ts');
const jsonPath = path.join(__dirname, '../public/data/executive-orders-full-text.json');

const helperSource = fs.readFileSync(helperPath, 'utf8');
const transpiled = ts.transpileModule(helperSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
  fileName: helperPath,
});

const helperUrl = 'data:text/javascript;charset=utf-8,' + encodeURIComponent(transpiled.outputText);
const { getRecordDataQuality } = await import(helperUrl);

const records = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

const findRecord = (predicate) => records.find(predicate) ?? null;

const samples = [
  {
    label: 'Fetched record with known EO number',
    record: findRecord((r) => r.full_text_status === 'fetched' && r.executive_order_number && String(r.executive_order_number).trim() !== ''),
  },
  {
    label: 'Missing_source record',
    record: findRecord((r) => r.full_text_status === 'missing_source'),
  },
  {
    label: 'Fetched record with missing executive_order_number',
    record: findRecord((r) => r.full_text_status === 'fetched' && (!r.executive_order_number || String(r.executive_order_number).trim() === '')),
  },
];

console.log('Data Quality Helper Test');
console.log('Loaded records:', records.length);

for (const sample of samples) {
  console.log('\n---', sample.label, '---');
  if (!sample.record) {
    console.log('No matching record found.');
    continue;
  }
  const quality = getRecordDataQuality(sample.record);
  console.log('executive_order_number:', sample.record.executive_order_number ?? 'N/A');
  console.log('document_number:', sample.record.document_number ?? 'N/A');
  console.log('full_text_status:', sample.record.full_text_status ?? 'N/A');
  console.log('title:', sample.record.title ?? 'N/A');
  console.log('classification:', JSON.stringify(quality, null, 2));
}
