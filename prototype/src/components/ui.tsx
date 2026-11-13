import { AlertCircle, ArrowUpRight, Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import { useWorkspace } from '../state/WorkspaceContext';
export function PageHeading({eyebrow,title,description,children}:{eyebrow?:string;title:string;description?:string;children?:ReactNode}) { return <header className="page-heading"><div>{eyebrow&&<p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description&&<p className="page-description">{description}</p>}</div>{children&&<div className="heading-actions">{children}</div>}</header>; }
export function Panel({title,subtitle,children,className='',action}:{title?:string;subtitle?:string;children:ReactNode;className?:string;action?:ReactNode}) { return <section className={`panel ${className}`}>{(title||action)&&<header className="panel-heading"><div>{title&&<h2>{title}</h2>}{subtitle&&<p>{subtitle}</p>}</div>{action}</header>}<div className="panel-body">{children}</div></section>; }
export function Badge({children,tone='muted'}:{children:ReactNode;tone?:'green'|'red'|'amber'|'blue'|'muted'|'purple'}) { return <span className={`badge ${tone}`}>{children}</span>; }
export function Notice({children}:{children:ReactNode}) { return <div className="notice"><AlertCircle size={16}/><div>{children}</div></div>; }
export function Empty({title,description,children}:{title:string;description?:string;children?:ReactNode}) { return <div className="empty"><Inbox size={30}/><h3>{title}</h3>{description&&<p>{description}</p>}{children}</div>; }
export function AssetLink({id}:{id:string}) { const {workspace,openAsset}=useWorkspace();const asset=workspace.assets.find(a=>a.id===id);return <button className="text-link" onClick={()=>openAsset(id)}>{asset?.name??id}<ArrowUpRight size={13}/></button>; }
export function formatTime(timestamp:string) { return new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(timestamp)); }
export function severityTone(level:string):'red'|'amber'|'blue'|'green' { return level==='Critical'?'red':level==='High'?'amber':level==='Medium'?'blue':'green'; }
