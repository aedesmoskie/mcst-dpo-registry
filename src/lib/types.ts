export interface Env { DB: D1Database; }
export interface McstRecord { id?:number; mcst_no:string; estate_name:string; uen:string; source:string; source_estate_name:string; }
export interface DpoObservation { organisationName:string; uen:string; dpoName:string; dpoEmail:string; dpoCompany:string; }
export interface OutputRow { 'MCST#':string; 'Estate Name':string; 'UEN':string; 'DPO(Y/N)':'Y'|'N'; 'DPO Name':string; 'DPO Email':string; 'DPO Company':string; 'Record Discrepancy(Y/N)':'Y'|'N'; }
export interface SyncResult { ok:boolean; count:number; inserted:number; updated:number; error?:string; }
