// Static SVG derived from the checked inline diagram. HTML remains authoritative.
import fs from 'node:fs';
const dir='docs/architecture/';
const slugs=['daubert-hub-v1-architecture','daubert-hub-v1-dataflow','daubert-hub-deployment'];
const receipts=[];
for(const slug of slugs){
 const html=fs.readFileSync(dir+slug+'.html','utf8');
 const svg=html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0];
 if(!svg) throw new Error('Missing diagram SVG: '+slug);
 const css=[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
 const exported=svg.replace(/<svg\b([^>]*)>/,(_match,attrs)=>'<svg'+attrs+(attrs.includes('xmlns=')?'':' xmlns="http://www.w3.org/2000/svg"')+'><style><![CDATA['+css+']]></style>');
 fs.writeFileSync(dir+slug+'.svg','<?xml version="1.0" encoding="UTF-8"?>\n'+exported+'\n');
 const receipt=JSON.parse(fs.readFileSync(dir+slug+'.finalize-summary.json','utf8'));
 if(!receipt.ok) throw new Error('Non-passing finalize: '+slug);
 receipts.push({diagram:slug,type:receipt.type,specification:receipt.specification,artifact:receipt.artifact,gates:receipt.gates,visualReview:{status:'passed',scope:'Inspección de capturas light 1440x900; comprobaciones automáticas light/dark a 1440x900 y 2048x1320.'},svg:{file:slug+'.svg',method:'Inline SVG + embedded stylesheet from checked HTML; static derivative, not a separate Archify finalize.'}});
}
fs.writeFileSync(dir+'validation-summary.json',JSON.stringify({repositoryRevision:'ac4575df870cc48d3db0b67b3daf8e0930bc8e50',diagrams:receipts},null,2)+'\n');
