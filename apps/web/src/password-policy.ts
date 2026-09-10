export const PASSWORD_MIN_LENGTH=8;
export const PASSWORD_MAX_LENGTH=128;

export function passwordMeetsPolicy(value:string):boolean{
  const normalized=value.normalize('NFKC');
  return value.length<=PASSWORD_MAX_LENGTH && normalized.length>=PASSWORD_MIN_LENGTH && normalized.length<=PASSWORD_MAX_LENGTH && /\p{Lu}/u.test(normalized) && /\p{Nd}/u.test(normalized);
}

export function validateNewPasswordInput(input:HTMLInputElement,message:string):void{
  input.setCustomValidity(input.value==='' || passwordMeetsPolicy(input.value)?'':message);
}
