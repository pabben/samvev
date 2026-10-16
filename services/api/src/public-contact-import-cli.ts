import {readFile,stat} from 'node:fs/promises';
import {basename,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DomainError} from '@samvev/core';
import {installationPublicContactUpdateSchema} from '@samvev/contracts';
import {pool} from './db.ts';
import {initializePublicContact} from './public-contact.ts';

function argument(name:string):string|undefined{const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:undefined;}
async function main(){
  const supplied=argument('--file');
  if(!supplied||!resolve(supplied).includes('/.local/')||basename(supplied)!=='owner-contact.private.json')throw new Error('Usage: npm run public-contact:initialize -- --file .local/m3/round13/owner-contact.private.json');
  const path=resolve(supplied),metadata=await stat(path);
  if(!metadata.isFile()||(metadata.mode&0o077)!==0)throw new Error('Private contact file must be a regular file with mode 0600');
  let raw:unknown;
  try{raw=JSON.parse(await readFile(path,'utf8'));}catch{throw new Error('Private contact file is not valid JSON');}
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Private contact file has an invalid shape');
  const source=raw as Record<string,unknown>;
  // The owner's separately confirmed private record uses explicit confirmation
  // field names. Map it here without echoing any values to stdout or errors.
  const parsed=installationPublicContactUpdateSchema.safeParse({expectedRevision:0,operatorName:source.confirmedName,postalAddress:source.confirmedPostalAddress,contactEmail:source.publicEmail});
  if(!parsed.success)throw new Error('Private contact file must contain valid confirmedName, confirmedPostalAddress, and publicEmail fields');
  try{
    const result=await initializePublicContact({operatorName:parsed.data.operatorName,postalAddress:parsed.data.postalAddress,contactEmail:parsed.data.contactEmail});
    process.stdout.write(`${JSON.stringify({configured:true,revision:result.revision})}\n`);
  }catch(error){
    if(error instanceof DomainError&&error.code==='CONFLICT')throw new Error('Public contact is already initialized; use installation settings to edit it');
    throw error;
  }finally{await pool.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
