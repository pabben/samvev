import pg from 'pg';
import { DomainError } from '@samvev/core';

const { Client } = pg;

export type ProjectionStreamEvent =
  | { type: 'projection-invalidated'; data: Record<string, never> }
  | { type: 'listener-degraded'; data: { pollingFallback: true; listenerConnected: boolean; reason: 'notification-listener-unavailable' | 'authorization-check-unavailable' } }
  | { type: 'listener-restored'; data: { pollingFallback: true; listenerConnected: true; refetchRequired: true } };

interface Subscription {
  displayId: string;
  householdId: string;
  send: (event: ProjectionStreamEvent) => void;
  close: () => void;
}

export class ProjectionEventFanout {
  private client: pg.Client | null = null;
  private connecting: Promise<void> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private nextId = 1;
  private readonly subscriptions = new Map<number,Subscription>();
  private readonly perDisplay = new Map<string,number>();
  private readonly maxGlobal = Math.max(10,Number(process.env.SAMVEV_SSE_MAX_GLOBAL ?? 100));
  private readonly maxPerDisplay = Math.max(10,Number(process.env.SAMVEV_SSE_MAX_PER_DISPLAY ?? 12));

  async start():Promise<void>{
    try{await this.ensureConnected();}catch{this.scheduleReconnect();}
  }

  subscribe(displayId:string,householdId:string,send:Subscription['send'],close:()=>void):()=>void{
    const displayCount=this.perDisplay.get(displayId) ?? 0;
    if(this.subscriptions.size>=this.maxGlobal || displayCount>=this.maxPerDisplay) throw new DomainError('RATE_LIMITED',429,{reason:'display_stream_limit'});
    const id=this.nextId++;
    this.subscriptions.set(id,{displayId,householdId,send,close});
    this.perDisplay.set(displayId,displayCount+1);
    void this.ensureConnected().catch(()=>this.scheduleReconnect());
    let active=true;
    return ()=>{
      if(!active)return;
      active=false;
      this.subscriptions.delete(id);
      const remaining=(this.perDisplay.get(displayId) ?? 1)-1;
      if(remaining>0)this.perDisplay.set(displayId,remaining);else this.perDisplay.delete(displayId);
    };
  }

  stats():{subscriptions:number;displays:number;listenerConnected:boolean}{
    return {subscriptions:this.subscriptions.size,displays:this.perDisplay.size,listenerConnected:Boolean(this.client)};
  }

  listenerConnected():boolean{return Boolean(this.client);}

  async close():Promise<void>{
    this.closed=true;
    if(this.reconnectTimer)clearTimeout(this.reconnectTimer);
    this.reconnectTimer=null;
    for(const subscription of this.subscriptions.values())subscription.close();
    this.subscriptions.clear();
    this.perDisplay.clear();
    const client=this.client;
    this.client=null;
    if(client){
      client.removeAllListeners();
      await client.query('UNLISTEN display_projection').catch(()=>undefined);
      await client.end().catch(()=>undefined);
    }
    await this.connecting?.catch(()=>undefined);
  }

  private async ensureConnected():Promise<void>{
    if(this.closed || this.client)return;
    if(this.connecting)return this.connecting;
    this.connecting=this.connect().finally(()=>{this.connecting=null;});
    return this.connecting;
  }

  private async connect():Promise<void>{
    const client=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:2_000,keepAlive:true,application_name:'samvev-api-projection-listener'});
    try{
      await client.connect();
      if(this.closed){await client.end();return;}
      await client.query('LISTEN display_projection');
      client.on('notification',(message)=>{
        if(message.channel!=='display_projection' || !message.payload)return;
        for(const subscription of this.subscriptions.values())if(subscription.householdId===message.payload)subscription.send({type:'projection-invalidated',data:{}});
      });
      const failed=()=>this.listenerFailed(client);
      client.once('error',failed);
      client.once('end',failed);
      this.client=client;
      for(const subscription of this.subscriptions.values())subscription.send({type:'listener-restored',data:{pollingFallback:true,listenerConnected:true,refetchRequired:true}});
    }catch(error){await client.end().catch(()=>undefined);throw error;}
  }

  private listenerFailed(client:pg.Client):void{
    if(this.client!==client || this.closed)return;
    this.client=null;
    client.removeAllListeners();
    void client.end().catch(()=>undefined);
    for(const subscription of this.subscriptions.values())subscription.send({type:'listener-degraded',data:{pollingFallback:true,listenerConnected:false,reason:'notification-listener-unavailable'}});
    this.scheduleReconnect();
  }

  private scheduleReconnect():void{
    if(this.closed || this.reconnectTimer)return;
    this.reconnectTimer=setTimeout(()=>{
      this.reconnectTimer=null;
      void this.ensureConnected().catch(()=>this.scheduleReconnect());
    },1_000);
    this.reconnectTimer.unref();
  }
}
