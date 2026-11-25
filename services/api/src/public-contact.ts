import {DomainError} from '@samvev/core';
import type {InstallationPublicContactUpdate} from '@samvev/contracts';
import {pool,transaction,type DbClient} from './db.ts';

export interface PublicContactActor {
  accountId:string;
  sessionId:string;
  installationId:string;
  membershipId:string;
  householdId:string;
}
export interface PublicContact {operatorName:string;postalAddress:string;contactEmail:string;revision:number;}
export type PublicContactDto=Pick<PublicContact,'operatorName'|'postalAddress'|'contactEmail'>;
type Row={operator_name:string;postal_address:string;contact_email:string;revision:number;};
function map(row:Row):PublicContact{return{operatorName:row.operator_name,postalAddress:row.postal_address,contactEmail:row.contact_email,revision:row.revision};}
function publicDto(row:Row):PublicContactDto{return{operatorName:row.operator_name,postalAddress:row.postal_address,contactEmail:row.contact_email};}

export async function readPublicContact(installationId:string):Promise<PublicContact|null>{
  const row=(await pool.query<Row>(`SELECT config.operator_name,config.postal_address,config.contact_email,config.revision
    FROM installation_public_contact_configs config JOIN installations installation ON installation.id=config.installation_id
    WHERE installation.id=$1 AND installation.singleton=true`,[installationId])).rows[0];
  return row?map(row):null;
}

export async function readAnonymousPublicContact():Promise<PublicContactDto|null>{
  const row=(await pool.query<Row>(`SELECT config.operator_name,config.postal_address,config.contact_email,config.revision
    FROM installation_public_contact_configs config JOIN installations installation ON installation.id=config.installation_id
    WHERE installation.singleton=true LIMIT 1`)).rows[0];
  return row?publicDto(row):null;
}

async function assertLiveInstallationAdmin(client:DbClient,actor:PublicContactActor):Promise<void>{
  const row=(await client.query(`SELECT 1
    FROM installations installation
    JOIN households household ON household.installation_id=installation.id AND household.id=$5
    JOIN sessions session ON session.id=$2 AND session.account_id=$1 AND session.revoked_at IS NULL AND session.expires_at>clock_timestamp()
    JOIN accounts account ON account.id=session.account_id AND account.installation_id=installation.id AND account.disabled_at IS NULL
    JOIN memberships membership ON membership.id=$3 AND membership.account_id=account.id AND membership.household_id=household.id AND membership.capabilities ? 'installation.manage'
    JOIN persons person ON person.id=membership.person_id AND person.household_id=household.id AND person.age_group='adult'
    WHERE installation.id=$4 FOR SHARE OF installation,session,account,membership,person`,[actor.accountId,actor.sessionId,actor.membershipId,actor.installationId,actor.householdId])).rowCount;
  if(!row)throw new DomainError('FORBIDDEN',403);
}

export async function updatePublicContact(actor:PublicContactActor,input:InstallationPublicContactUpdate):Promise<PublicContact>{
  return transaction(async(client)=>{
    // Serialize contact writers without blocking audit foreign-key KEY SHARE
    // locks held by person/profile transactions awaiting this administrator.
    await client.query('SELECT id FROM installations WHERE id=$1 AND singleton=true FOR NO KEY UPDATE',[actor.installationId]);
    await assertLiveInstallationAdmin(client,actor);
    const current=(await client.query<Row>(`SELECT operator_name,postal_address,contact_email,revision
      FROM installation_public_contact_configs WHERE installation_id=$1 FOR UPDATE`,[actor.installationId])).rows[0];
    const revision=current?.revision??0;
    if(revision!==input.expectedRevision)throw new DomainError('REVISION_CONFLICT',409,{revision});
    const next=revision+1;
    const row=(await client.query<Row>(`INSERT INTO installation_public_contact_configs(installation_id,operator_name,postal_address,contact_email,revision,updated_by_account_id)
      VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(installation_id) DO UPDATE SET operator_name=EXCLUDED.operator_name,postal_address=EXCLUDED.postal_address,
        contact_email=EXCLUDED.contact_email,revision=EXCLUDED.revision,updated_by_account_id=EXCLUDED.updated_by_account_id,updated_at=clock_timestamp()
      RETURNING operator_name,postal_address,contact_email,revision`,[actor.installationId,input.operatorName,input.postalAddress,input.contactEmail,next,actor.accountId])).rows[0]!;
    await client.query(`INSERT INTO audit_events(installation_id,household_id,actor_type,actor_id,action,subject_type,subject_id,metadata)
      VALUES($1,NULL,'account',$2,'installation.public_contact_updated','installation_public_contact',$1,$3)`,[actor.installationId,actor.accountId,JSON.stringify({revision:next})]);
    // Writes and audit insertion can wait on locks. Recheck authority as the last
    // awaited operation so a session revoked during that wait cannot complete.
    await assertLiveInstallationAdmin(client,actor);
    return map(row);
  });
}

export async function initializePublicContact(input:Omit<InstallationPublicContactUpdate,'expectedRevision'>):Promise<{installationId:string;revision:number}>{
  return transaction(async(client)=>{
    const installation=(await client.query<{id:string}>(`SELECT id FROM installations WHERE singleton=true FOR NO KEY UPDATE`)).rows[0];
    if(!installation)throw new DomainError('NOT_FOUND',404);
    const row=await client.query(`INSERT INTO installation_public_contact_configs(installation_id,operator_name,postal_address,contact_email,revision,updated_by_account_id)
      VALUES($1,$2,$3,$4,1,NULL) ON CONFLICT(installation_id) DO NOTHING`,[installation.id,input.operatorName,input.postalAddress,input.contactEmail]);
    if(!row.rowCount)throw new DomainError('CONFLICT',409,{reason:'public_contact_already_initialized'});
    await client.query(`INSERT INTO audit_events(installation_id,household_id,actor_type,actor_id,action,subject_type,subject_id,metadata)
      VALUES($1,NULL,'system',NULL,'installation.public_contact_initialized','installation_public_contact',$1,'{"revision":1}'::jsonb)`,[installation.id]);
    return{installationId:installation.id,revision:1};
  });
}
