import { z } from 'zod';
import { roleCapabilityPresets, birthDateSchema, emailSchema, localeSchema, nameSchema, rolePresetSchema, themeSchema } from '@samvev/contracts';
import { DomainError, opaqueToken, tokenHash, validateIanaTimezone } from '@samvev/core';
import { pool, transaction } from '../db.ts';
import { deriveAgeGroup, localDateInTimezone } from './domain.ts';

const personInput=z.object({
  displayName:nameSchema,birthDate:birthDateSchema.nullable().optional(),ageGroup:z.enum(['adult','teen','child','unspecified']).optional(),
  rolePreset:rolePresetSchema,email:emailSchema.optional(),locale:localeSchema.default('nb'),theme:themeSchema.default('system')
}).strict();
export const localBootstrapInputSchema=z.discriminatedUnion('phase',[
  z.object({phase:z.literal('prepare'),operationKey:z.string().min(8).max(128),sourceHouseholdId:z.string().uuid(),household:z.object({name:nameSchema,timezone:z.string().min(1).max(80),locale:localeSchema.default('nb'),showUpcomingBirthday:z.boolean().default(false)}).strict(),people:z.array(personInput).min(1).max(50)}).strict(),
  z.object({phase:z.literal('finalize'),operationKey:z.string().min(8).max(128),confirmDisableSourceAccounts:z.literal(true)}).strict(),
  z.object({phase:z.literal('rotate'),operationKey:z.string().min(8).max(128),confirmRotateInvitations:z.literal(true)}).strict()
]);

export type LocalBootstrapInput=z.infer<typeof localBootstrapInputSchema>;

export async function runLocalBootstrap(raw:unknown):Promise<Record<string,unknown>>{
  const input=localBootstrapInputSchema.parse(raw);
  if(input.phase==='finalize')return finalize(input.operationKey);
  if(input.phase==='rotate')return rotate(input.operationKey);
  if(!validateIanaTimezone(input.household.timezone))throw new DomainError('VALIDATION_FAILED',400,{reason:'invalid_timezone'});
  const owners=input.people.filter((person)=>person.rolePreset==='installation_admin');
  if(owners.length!==1 || !owners[0]!.email)throw new DomainError('VALIDATION_FAILED',400,{reason:'exactly_one_owner_with_email_required'});
  return transaction(async(client)=>{
    const existing=await client.query<{live_household_id:string;state:string}>(`SELECT live_household_id,state FROM local_bootstrap_transitions WHERE operation_key=$1`,[input.operationKey]);
    if(existing.rows[0])return {status:existing.rows[0].state,liveHouseholdId:existing.rows[0].live_household_id,idempotent:true,invitations:[]};
    const source=await client.query<{installation_id:string;data_kind:string}>(`SELECT installation_id,data_kind FROM households WHERE id=$1 FOR UPDATE`,[input.sourceHouseholdId]);
    if(!source.rows[0])throw new DomainError('NOT_FOUND',404);
    if(!['synthetic','demo'].includes(source.rows[0].data_kind))throw new DomainError('CONFLICT',409,{reason:'source_household_not_synthetic'});
    const installationId=source.rows[0].installation_id;
    const live=(await client.query<{id:string}>(`INSERT INTO households(installation_id,name,timezone,default_locale,show_upcoming_birthday,data_kind) VALUES($1,$2,$3,$4,$5,'live') RETURNING id`,[installationId,input.household.name,input.household.timezone,input.household.locale,input.household.showUpcomingBirthday])).rows[0]!;
    const today=localDateInTimezone(new Date(),input.household.timezone);
    const created:Array<{membershipId:string;accountId:string|null;invitationId:string|null;token:string|null;email:string|null}>=[];
    for(const person of input.people){
      if((person.rolePreset==='installation_admin'||person.rolePreset==='household_admin')&&!person.email)throw new DomainError('VALIDATION_FAILED',400,{reason:'administrator_login_required'});
      const personId=(await client.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group,birth_date) VALUES($1,$2,$3,$4) RETURNING id`,[live.id,person.displayName,person.ageGroup??deriveAgeGroup(person.birthDate,today),person.birthDate??null])).rows[0]!.id;
      let accountId:string|null=null;let invitationId:string|null=null;let token:string|null=null;
      if(person.email){
        accountId=(await client.query<{id:string}>(`INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme) VALUES($1,$2,NULL,$3,$4) RETURNING id`,[installationId,person.email,person.locale,person.theme])).rows[0]!.id;
      }
      const membershipId=(await client.query<{id:string}>(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES($1,$2,$3,$4,$5) RETURNING id`,[live.id,accountId,personId,person.rolePreset,JSON.stringify(roleCapabilityPresets[person.rolePreset])])).rows[0]!.id;
      if(accountId){token=opaqueToken();invitationId=(await client.query<{id:string}>(`INSERT INTO account_invitations(installation_id,household_id,account_id,token_hash,expires_at) VALUES($1,$2,$3,$4,clock_timestamp()+interval '14 days') RETURNING id`,[installationId,live.id,accountId,tokenHash(token)])).rows[0]!.id;}
      created.push({membershipId,accountId,invitationId,token,email:person.email??null});
    }
    const owner=created[input.people.findIndex((person)=>person.rolePreset==='installation_admin')]!;
    const transition=(await client.query<{id:string}>(`INSERT INTO local_bootstrap_transitions(operation_key,installation_id,source_household_id,live_household_id,owner_account_id,owner_invitation_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[input.operationKey,installationId,input.sourceHouseholdId,live.id,owner.accountId,owner.invitationId])).rows[0]!;
    for(const row of created)await client.query(`INSERT INTO local_bootstrap_members(transition_id,membership_id,account_id,invitation_id) VALUES($1,$2,$3,$4)`,[transition.id,row.membershipId,row.accountId,row.invitationId]);
    await client.query(`UPDATE households SET data_kind='synthetic',revision=revision+1 WHERE id=$1`,[input.sourceHouseholdId]);
    await client.query(`UPDATE installations SET default_locale=$2 WHERE id=$1`,[installationId,input.household.locale]);
    await client.query(`INSERT INTO audit_events(installation_id,household_id,actor_type,action,subject_type,subject_id,metadata) VALUES($1,$2,'system','local_bootstrap.prepared','household',$2,$3)`,[installationId,live.id,JSON.stringify({sourceHouseholdId:input.sourceHouseholdId,operationKey:input.operationKey})]);
    return {status:'prepared',liveHouseholdId:live.id,idempotent:false,invitations:created.filter((row)=>row.token).map((row)=>({email:row.email,token:row.token,invitePath:`/invitation#token=${row.token}`}))};
  });
}

async function rotate(operationKey:string):Promise<Record<string,unknown>>{
  return transaction(async(client)=>{
    const transition=await client.query<{id:string;installation_id:string;live_household_id:string;owner_account_id:string;state:string}>(`SELECT id,installation_id,live_household_id,owner_account_id,state FROM local_bootstrap_transitions WHERE operation_key=$1 FOR UPDATE`,[operationKey]);
    const row=transition.rows[0];if(!row)throw new DomainError('NOT_FOUND',404);
    if(row.state!=='prepared')throw new DomainError('CONFLICT',409,{reason:'bootstrap_already_finalized'});
    const pending=await client.query<{account_id:string;email_normalized:string}>(`SELECT a.id AS account_id,a.email_normalized FROM local_bootstrap_members bm JOIN accounts a ON a.id=bm.account_id WHERE bm.transition_id=$1 AND a.password_hash IS NULL AND a.disabled_at IS NULL ORDER BY a.email_normalized,a.id FOR UPDATE OF a`,[row.id]);
    const invitations:Array<{email:string;token:string;invitePath:string}>= [];
    for(const account of pending.rows){
      const token=opaqueToken();
      await client.query(`UPDATE account_invitations SET revoked_at=clock_timestamp() WHERE account_id=$1 AND accepted_at IS NULL AND revoked_at IS NULL`,[account.account_id]);
      const invitation=(await client.query<{id:string}>(`INSERT INTO account_invitations(installation_id,household_id,account_id,token_hash,expires_at) VALUES($1,$2,$3,$4,clock_timestamp()+interval '14 days') RETURNING id`,[row.installation_id,row.live_household_id,account.account_id,tokenHash(token)])).rows[0]!;
      await client.query(`UPDATE local_bootstrap_members SET invitation_id=$3 WHERE transition_id=$1 AND account_id=$2`,[row.id,account.account_id,invitation.id]);
      if(account.account_id===row.owner_account_id)await client.query(`UPDATE local_bootstrap_transitions SET owner_invitation_id=$2 WHERE id=$1`,[row.id,invitation.id]);
      invitations.push({email:account.email_normalized,token,invitePath:`/invitation#token=${token}`});
    }
    await client.query(`INSERT INTO audit_events(installation_id,household_id,actor_type,action,subject_type,subject_id,metadata) VALUES($1,$2,'system','local_bootstrap.invitations_rotated','household',$2,$3)`,[row.installation_id,row.live_household_id,JSON.stringify({operationKey,count:invitations.length})]);
    return {status:'prepared',liveHouseholdId:row.live_household_id,invitations};
  });
}

async function finalize(operationKey:string):Promise<Record<string,unknown>>{
  return transaction(async(client)=>{
    const transition=await client.query<{id:string;installation_id:string;source_household_id:string;live_household_id:string;owner_account_id:string;owner_invitation_id:string;state:string}>(`SELECT * FROM local_bootstrap_transitions WHERE operation_key=$1 FOR UPDATE`,[operationKey]);
    const row=transition.rows[0];if(!row)throw new DomainError('NOT_FOUND',404);
    if(row.state==='finalized')return {status:'finalized',liveHouseholdId:row.live_household_id,idempotent:true,disabledSourceAccounts:0};
    // Membership/account mutations take the same installation lock. Keep the owner
    // verification and source-account disable atomic with those operations.
    await client.query(`SELECT id FROM installations WHERE id=$1 FOR UPDATE`,[row.installation_id]);
    const verified=await client.query(`SELECT 1
      FROM account_invitations i
      JOIN accounts a ON a.id=i.account_id AND a.installation_id=$4
      JOIN memberships m ON m.account_id=a.id AND m.household_id=$3
      WHERE i.id=$1 AND i.account_id=$2 AND i.household_id=$3
        AND i.accepted_at IS NOT NULL AND i.revoked_at IS NULL
        AND a.disabled_at IS NULL AND a.password_hash IS NOT NULL
        AND m.role_preset='installation_admin'
        AND m.capabilities ?& ARRAY['installation.manage','capability.manage']
        AND EXISTS(SELECT 1 FROM sessions s
          WHERE s.account_id=a.id AND s.created_at>=i.accepted_at
            AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp())`,
      [row.owner_invitation_id,row.owner_account_id,row.live_household_id,row.installation_id]);
    if(!verified.rowCount)throw new DomainError('CONFLICT',409,{reason:'new_owner_not_verified'});
    const overlap=await client.query(`SELECT 1 FROM memberships source_m JOIN memberships other_m ON other_m.account_id=source_m.account_id AND other_m.household_id<>source_m.household_id WHERE source_m.household_id=$1 LIMIT 1`,[row.source_household_id]);
    if(overlap.rowCount)throw new DomainError('CONFLICT',409,{reason:'source_account_shared_with_other_household'});
    const disabled=await client.query(`UPDATE accounts SET disabled_at=COALESCE(disabled_at,clock_timestamp()),revision=revision+1 WHERE id IN(SELECT account_id FROM memberships WHERE household_id=$1 AND account_id IS NOT NULL) AND disabled_at IS NULL RETURNING id`,[row.source_household_id]);
    await client.query(`UPDATE sessions SET revoked_at=clock_timestamp() WHERE account_id IN(SELECT account_id FROM memberships WHERE household_id=$1 AND account_id IS NOT NULL) AND revoked_at IS NULL`,[row.source_household_id]);
    await client.query(`UPDATE local_bootstrap_transitions SET state='finalized',finalized_at=clock_timestamp() WHERE id=$1`,[row.id]);
    await client.query(`INSERT INTO audit_events(installation_id,household_id,actor_type,action,subject_type,subject_id,metadata) VALUES($1,$2,'system','local_bootstrap.finalized','household',$2,$3)`,[row.installation_id,row.live_household_id,JSON.stringify({sourceHouseholdId:row.source_household_id,operationKey})]);
    return {status:'finalized',liveHouseholdId:row.live_household_id,idempotent:false,disabledSourceAccounts:disabled.rowCount??0};
  });
}
