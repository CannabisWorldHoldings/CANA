from __future__ import annotations
import datetime as dt
import json
import sys
from dataclasses import replace
from pathlib import Path

HERE=Path(__file__).resolve()
ROOT=HERE.parents[2]
sys.path.insert(0,str(ROOT/'rsi-sitemind-core'/'src'))
sys.path.insert(0,str(ROOT/'rsi-domain-connectors'/'src'))
sys.path.insert(0,str(ROOT/'rsi-hermes-bridge'/'src'))

from rsi_sitemind_core import ActionContract, AuthorizationGrant, Ed25519Keypair, PublicKeyRegistry, ReceiptLedger, RSIGovernor, WorkerCapability
from rsi_domain_connectors import InMemoryCMSConnector
from rsi_hermes_bridge import GovernedExecutor

NOW=dt.datetime(2026,7,23,16,0,tzinfo=dt.timezone.utc)

def sign(record, signer):
    record=replace(record,key_id=signer.key_id,signature='')
    return replace(record,signature=signer.sign(record.unsigned_payload()))

def fixtures():
    signer=Ed25519Keypair.generate('court')
    keys=PublicKeyRegistry({signer.key_id:signer.public_bytes_b64()})
    gov=RSIGovernor(keys)
    ledger=ReceiptLedger(signer,keys)
    executor=GovernedExecutor(gov,ledger,{'cms':InMemoryCMSConnector()})
    auth=sign(AuthorizationGrant(authorization_id='auth',tenant_id='ta',business_id='ba',site_id='sa',actor_id='owner',allowed_action_types=('publish_cms_draft',),allowed_resources=('cms://sa/drafts',),maximum_financial_exposure=10,valid_from='2026-07-23T15:00:00Z',valid_until='2026-07-23T17:00:00Z'),signer)
    cap=sign(WorkerCapability(capability_id='cap',tenant_id='ta',business_id='ba',site_id='sa',mission_id='m',worker_id='w',worker_role='content',permitted_action_types=('publish_cms_draft',),permitted_resources=('cms://sa/drafts',),maximum_financial_exposure=5,maximum_runtime_seconds=300,maximum_calls=3,valid_from='2026-07-23T15:00:00Z',valid_until='2026-07-23T17:00:00Z'),signer)
    action=sign(ActionContract(action_contract_id='act',tenant_id='ta',business_id='ba',site_id='sa',mission_id='m',actor_id='owner',worker_id='w',action_type='publish_cms_draft',authorization_id='auth',capability_id='cap',resource='cms://sa/drafts',financial_exposure=0,valid_from='2026-07-23T15:00:00Z',valid_until='2026-07-23T17:00:00Z',evidence_references=('claim',),preconditions=('verified',),postconditions=('draft',),idempotency_key='idem',reversible=True,rollback_contract={'action':'delete'}),signer)
    return signer,executor,auth,cap,action

def run():
    signer,ex,auth,cap,action=fixtures()
    attacks=[]
    def check(name, a=action, au=auth, c=cap, expect='DENIED'):
        result=ex.execute(a,au,c,{'content':'safe'},now=NOW)
        passed=result['status']==expect
        attacks.append({'attack':name,'expected':expect,'observed':result['status'],'passed':passed,'reasons':result.get('reasons',[])})
    # valid execution first
    check('valid_control',expect='SUCCEEDED')
    # replay same contract
    check('idempotency_replay')
    # tampered tenant without resigning
    check('tampered_tenant',a=replace(action,tenant_id='tb'))
    # cross tenant resigned
    cross=sign(replace(action,tenant_id='tb',idempotency_key='cross',signature=''),signer)
    check('cross_tenant_resigned',a=cross)
    # negative spend
    neg=sign(replace(action,financial_exposure=-1,idempotency_key='neg',signature=''),signer)
    check('negative_spend',a=neg)
    # over budget
    over=sign(replace(action,financial_exposure=100,idempotency_key='over',signature=''),signer)
    check('over_budget',a=over)
    # expired auth
    expired=sign(replace(auth,valid_from='2026-07-23T13:00:00Z',valid_until='2026-07-23T14:00:00Z',signature=''),signer)
    check('expired_authorization',au=expired,a=sign(replace(action,idempotency_key='expired',signature=''),signer))
    # unsigned action
    check('unsigned_action',a=replace(action,idempotency_key='unsigned',key_id='',signature=''))
    # irreversible without authority
    irrev=sign(replace(action,idempotency_key='irrev',reversible=False,rollback_contract={},signature=''),signer)
    check('irreversible_action',a=irrev)
    # wrong resource
    wrong=sign(replace(action,idempotency_key='wrong',resource='cms://other/drafts',signature=''),signer)
    check('resource_escape',a=wrong)
    # delegation overflow
    badcap=sign(replace(cap,delegation_depth=2,maximum_delegation_depth=1,signature=''),signer)
    check('delegation_overflow',c=badcap,a=sign(replace(action,idempotency_key='depth',signature=''),signer))
    malformed=sign(replace(action,idempotency_key='badtime',valid_until='invalid',signature=''),signer)
    check('malformed_timestamp',a=malformed)
    revoked=sign(replace(auth,revoked=True,signature=''),signer)
    check('revoked_authorization',au=revoked,a=sign(replace(action,idempotency_key='revoked',signature=''),signer))
    noevidence=sign(replace(action,idempotency_key='noevidence',evidence_references=(),signature=''),signer)
    check('missing_evidence',a=noevidence)
    norollback=sign(replace(action,idempotency_key='norollback',rollback_contract={},signature=''),signer)
    check('missing_rollback',a=norollback)
    conflict=sign(replace(action,idempotency_key='conflict',permitted_side_effects=('publish',),prohibited_side_effects=('publish',),signature=''),signer)
    check('side_effect_conflict',a=conflict)
    policy=sign(replace(action,idempotency_key='policy',policy_version='other',signature=''),signer)
    check('policy_version_mismatch',a=policy)
    badworker=sign(replace(cap,worker_id='other',signature=''),signer)
    check('worker_identity_mismatch',c=badworker,a=sign(replace(action,idempotency_key='worker',signature=''),signer))
    zerobudget=sign(replace(cap,maximum_runtime_seconds=0,maximum_calls=0,signature=''),signer)
    check('invalid_worker_budgets',c=zerobudget,a=sign(replace(action,idempotency_key='zero',signature=''),signer))
    ok=all(x['passed'] for x in attacks)
    report={'passed':ok,'total':len(attacks),'passed_count':sum(x['passed'] for x in attacks),'attacks':attacks}
    out=HERE.parent/'ATTACK_COURT_RECEIPT.json'
    out.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
    return 0 if ok else 1

if __name__=='__main__': raise SystemExit(run())
