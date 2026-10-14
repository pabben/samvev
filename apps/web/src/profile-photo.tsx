import {squareCrop} from './photo-presentation';
import {useEffect,useRef,useState} from 'react';
import {api,ApiError} from './api';
import {Avatar,Dialog,ErrorNotice,Field,useAction,useI18n} from './ui';
import type {Person} from './types';
export function PhotoEditor({person,householdId,onClose,onSaved}:{person:Person;householdId:string;onClose:()=>void;onSaved:()=>Promise<void>}){
 const {t}=useI18n(),{run,busy,error,setError}=useAction();
 const [selection,setSelection]=useState<{url:string;base64:string;width:number;height:number}>();
 const [zoom,setZoom]=useState(1),[x,setX]=useState(.5),[y,setY]=useState(.5);
 const generation=useRef(0);const canvas=useRef<HTMLCanvasElement>(null);
 useEffect(()=>()=>{generation.current++},[]);
 const crop=selection?squareCrop(selection.width,selection.height,zoom,x,y):undefined;
 useEffect(()=>{if(!selection||!crop)return;let active=true;const image=new Image();image.onload=()=>{if(!active)return;canvas.current?.getContext('2d')?.drawImage(image,crop.x*selection.width,crop.y*selection.height,crop.width*selection.width,crop.height*selection.height,0,0,256,256)};image.src=selection.url;return()=>{active=false}},[selection,zoom,x,y]);
 const choose=async(file:File|undefined)=>{
  if(!file)return;
  const current=++generation.current;setError(null);setSelection(undefined);
  if(file.size>10*1024*1024){setError(new ApiError('photo_too_large'));return}
  try{
   // The application CSP permits data: images, not blob: images. Decode the
   // FileReader URL directly; the server still validates the actual bytes.
   const url=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(file)});
   const image=new Image();image.src=url;await image.decode();
   if(image.naturalWidth*image.naturalHeight>40_000_000)throw new ApiError('photo_dimensions_too_large');
   if(current!==generation.current)return;
   setSelection({url,base64:url.slice(url.indexOf(',')+1),width:image.naturalWidth,height:image.naturalHeight});setZoom(1);setX(.5);setY(.5);
  }catch(error){if(current===generation.current)setError(error instanceof ApiError?error:new ApiError('photo_invalid'))}
 };
 const base=`/households/${householdId}/people/${person.id}/photo`;
 return <Dialog title={t('photoTitle',{name:person.display_name})} onClose={onClose}><div className="form-stack photo-editor" aria-busy={busy}>
 <p>{t('photoHint')}</p>{selection?<canvas ref={canvas} width={256} height={256} role="img" aria-label={t('photoPreview')}/>:<div className="photo-current"><Avatar name={person.display_name} personId={person.id} avatarKey={person.avatarKey} photo={person.photo}/></div>}
 <Field label={t('photoChoose')}><input type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif" disabled={busy} onChange={event=>void choose(event.target.files?.[0])}/></Field>
 <Field label={t('photoCamera')}><input type="file" accept="image/*" capture="user" disabled={busy} onChange={event=>void choose(event.target.files?.[0])}/></Field>
 {selection&&<fieldset className="form-stack"><legend>{t('photoCrop')}</legend><Field label={t('photoZoom')}><input type="range" min="1" max="4" step="0.05" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/></Field><Field label={t('photoHorizontal')}><input type="range" min="0" max="1" step="0.01" value={x} onChange={e=>setX(Number(e.target.value))}/></Field><Field label={t('photoVertical')}><input type="range" min="0" max="1" step="0.01" value={y} onChange={e=>setY(Number(e.target.value))}/></Field></fieldset>}
 <ErrorNotice error={error}/><div className="form-actions"><button type="button" className="button" onClick={onClose}>{t('cancel')}</button>{person.photo&&<button type="button" className="button" disabled={busy} onClick={()=>void run(async()=>{await api(base,'DELETE',{expectedPhotoRevision:person.photoRevision??person.photo!.revision});await onSaved();onClose()})}>{t('photoRemove')}</button>}<button className="button primary" disabled={busy||!selection} onClick={()=>void run(async()=>{await api(base,'PUT',{imageBase64:selection!.base64,expectedPhotoRevision:person.photoRevision??0,crop});await onSaved();onClose()})}>{t(busy?'saving':'save')}</button></div>
 </div></Dialog>;
}
