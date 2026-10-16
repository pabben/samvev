export interface GoogleBrandingUrls {
  publicOrigin:string;
  homePage:string;
  privacyPolicy:string;
  termsOfService:string;
  authorizedDomain:string|null;
}

/** Derive public Branding URLs only from the server-issued OAuth callback URI. */
export function googleBrandingUrls(redirectUri:string):GoogleBrandingUrls{
  const callback=new URL(redirectUri);
  if(!['https:','http:'].includes(callback.protocol)||callback.username||callback.password)throw new Error('invalid_calendar_callback_origin');
  const publicOrigin=callback.origin;
  return{
    publicOrigin,
    homePage:new URL('/om',publicOrigin).toString(),
    privacyPolicy:new URL('/personvern',publicOrigin).toString(),
    termsOfService:new URL('/vilkar',publicOrigin).toString(),
    // Do not guess a registrable domain from arbitrary deployment hostnames.
    authorizedDomain:callback.hostname.toLowerCase()==='samvev.pabben.org'?'pabben.org':null,
  };
}
