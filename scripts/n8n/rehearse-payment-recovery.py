"""PR17 integration rehearsal. All execution targets are NEW internal-network Docker containers."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import time
import zipfile

PREFIX = 'daubert-review17-'
PG, N8N, GRAPH, API, NET = [PREFIX + x for x in ('pg', 'n8n', 'graph', 'api', 'net')]
PASSWORD = 'Synthetic-Review17-Only-Password'
REPO = Path(__file__).resolve().parents[2]
WORKFLOW = 'pagosProdAsignaciones01'
CHILD = 'pagosProdRecuperacion01'
N8N_COOKIE = None


def command(args, data=None, timeout=120, check=True):
    result = subprocess.run(args, input=data, capture_output=True, timeout=timeout)
    if check and result.returncode:
        raise RuntimeError('Command failed: ' + ' '.join(args[:5]) + '\n' + (result.stdout + result.stderr).decode('utf-8', 'replace')[-3000:])
    return result


def docker(*args, **kwargs):
    return command(['docker', *args], **kwargs)


def sql(text, check=True, database='daubert_global'):
    assert PG.startswith(PREFIX)
    assert database in ('daubert_global', 'review_checkpoint', 'review_interrupted')
    return docker('exec', '-i', PG, 'psql', '-X', '-U', 'postgres', '-d', database,
                  '-v', 'ON_ERROR_STOP=1', '-At', data=text.encode(), check=check)


def rows(query, database='daubert_global'):
    out = sql('WITH t AS (' + query + ') SELECT COALESCE(json_agg(t),\'[]\'::json) FROM t;', database=database).stdout.decode()
    return json.loads(out)


def wait(condition, timeout=60, label='condition'):
    until = time.time() + timeout
    while time.time() < until:
        result = condition()
        if result:
            return result
        time.sleep(.3)
    raise AssertionError('Timed out: ' + label)


def native_fetch(container, url, method='GET', body=None, headers=None):
    script = "(async()=>{const body=require('fs').readFileSync(0,'utf8');const r=await fetch(process.argv[1],{method:process.argv[2],headers:JSON.parse(process.argv[3]),...(body?{body}:{})});console.log(JSON.stringify({status:r.status,headers:Object.fromEntries(r.headers),body:await r.text()}));})().catch(e=>{console.error(e.message);process.exitCode=1})"
    r = docker('exec', '-i', container, 'node', '-e', script, url, method, json.dumps(headers or {}), data=json.dumps(body).encode() if body is not None else b'')
    return json.loads(r.stdout)


def state(root):
    with closing(sqlite3.connect((root / 'n8n-home/database.sqlite').as_uri() + '?mode=ro', uri=True, timeout=5)) as c:
        c.row_factory = sqlite3.Row
        c.execute('PRAGMA query_only=ON')
        return [dict(r) for r in c.execute('SELECT id,workflowId,mode,status,startedAt,stoppedAt FROM execution_entity ORDER BY id')]


def execution_data(root, eid):
    with closing(sqlite3.connect((root / 'n8n-home/database.sqlite').as_uri() + '?mode=ro', uri=True, timeout=5)) as c:
        c.execute('PRAGMA query_only=ON'); text = c.execute('SELECT data FROM execution_data WHERE executionId=?', (eid,)).fetchone()[0]
    pool = json.loads(text); memo = {}
    def value(v):
        if isinstance(v, str): return ref(int(v))
        if isinstance(v, list): return [value(x) for x in v]
        if isinstance(v, dict): return {k: value(x) for k, x in v.items()}
        return v
    def ref(i):
        if i in memo: return memo[i]
        v = pool[i]
        if isinstance(v, str): return v
        if isinstance(v, dict):
            out = {}; memo[i] = out; out.update({k: value(x) for k, x in v.items()}); return out
        if isinstance(v, list):
            out = []; memo[i] = out; out.extend(value(x) for x in v); return out
        return v
    return ref(0)


def drain(root):
    return wait(lambda: not [e for e in state(root) if e['status'] in ('new', 'running', 'waiting')], timeout=240, label='n8n drain')


def pdf(label):
    stream = ('BT /F1 12 Tf 50 700 Td (Fecha de aplicaci\xf3n: 23/10/2026 ' + label + ') Tj ET').encode('latin1')
    objects = [b'<</Type/Catalog/Pages 2 0 R>>', b'<</Type/Pages/Kids[3 0 R]/Count 1>>',
               b'<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
               b'<</Length ' + str(len(stream)).encode() + b'>>\nstream\n' + stream + b'\nendstream',
               b'<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>']
    out = b'%PDF-1.4\n'; offsets = []
    for i, obj in enumerate(objects, 1):
        offsets.append(len(out)); out += str(i).encode() + b' 0 obj\n' + obj + b'\nendobj\n'
    x = len(out)
    return out + ('xref\n0 6\n0000000000 65535 f \n' + ''.join(f'{o:010d} 00000 n \n' for o in offsets) +
                  f'trailer<</Size 6/Root 1 0 R>>\nstartxref\n{x}\n%%EOF').encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def adapt(workflow, root, is_error=False):
    workflow = json.loads(json.dumps(workflow)); changed = []
    for node in workflow['nodes']:
        for key in node.get('credentials', {}):
            node['credentials'][key] = {'id': {'postgres': 'reviewPg', 'microsoftOutlookOAuth2Api': 'reviewMs', 'httpHeaderAuth': 'reviewHeader'}[key], 'name': 'SYNTHETIC REVIEW ONLY'}
        code = node.get('parameters', {}).get('jsCode')
        if code and node['name'] == 'Configurar entorno':
            code, count = re.subn(r'const DROPBOX = String\.raw`[^`]+`;', 'const DROPBOX = "/data/review/dropbox";', code)
            assert count == 1; node['parameters']['jsCode'] = code; changed.append(node['name'] + ': root path')
        if code and is_error:
            code, count = re.subn(r'const ROOT_LOGS\s*=\s*.*?;', 'const ROOT_LOGS = "/data/review/dropbox/HERRAMIENTAS AUTOMATIZACION/NOTIFICACIONES DE PAGO/03_LOGS";', code, count=1, flags=re.S)
            assert count == 1; node['parameters']['jsCode'] = code; changed.append(node['name'] + ': log path')
        if node['name'] == 'Send a message':
            node['parameters']['toRecipients'] = 'summary@example.test'
            node['parameters']['additionalFields']['ccRecipients'] = 'review@example.test'
            changed.append(node['name'] + ': mail routing')
        if node['name'] == 'Clasificar con catalogo':
            # Fixture catalog paths use POSIX separators; no algorithm/normalization changes.
            assert 'path.resolve' in code
    workflow['active'] = False
    return workflow, changed


def prepare(root, private):
    parent = json.loads((private / 'payment-recovery-prod-parent.json').read_text(encoding='utf-8'))
    child = json.loads((private / 'payment-recovery-prod-child.json').read_text(encoding='utf-8'))
    manifest = json.loads((private / 'payment-recovery-prod.manifest.json').read_text())
    for name in ('parent', 'child'):
        assert digest((private / f'payment-recovery-prod-{name}.json').read_bytes()) == manifest['artifacts'][name]['sha256']
    error = json.loads((root / 'error-workflow-source.json').read_text(encoding='utf-8'))
    assert error['id'] == parent['settings']['errorWorkflow'] == child['settings']['errorWorkflow']
    adapters = {}
    for label, original in [('parent', parent), ('child', child), ('error', error)]:
        adapted, delta = adapt(original, root, label == 'error'); adapters[label] = delta
        (root / f'{label}.json').write_text(json.dumps(adapted, ensure_ascii=False), encoding='utf-8')
    baseline, _ = adapt(json.loads((private / 'payment-production-source.json').read_text(encoding='utf-8')), root)
    (root / 'baseline-parent.json').write_text(json.dumps(baseline, ensure_ascii=False), encoding='utf-8')
    (root / 'adapters.json').write_text(json.dumps(adapters, indent=2))
    creds = [
        {'id': 'reviewPg', 'name': 'SYNTHETIC REVIEW ONLY', 'type': 'postgres', 'data': {'host': PG, 'port': 5432, 'database': 'daubert_global', 'user': 'n8n_app', 'password': PASSWORD, 'ssl': 'disable'}},
        {'id': 'reviewMs', 'name': 'SYNTHETIC REVIEW ONLY', 'type': 'microsoftOutlookOAuth2Api', 'data': {'clientId': 'synthetic-client', 'clientSecret': 'synthetic-secret', 'oauthTokenData': {'access_token': 'synthetic-access-token', 'refresh_token': 'synthetic-refresh-token', 'token_type': 'Bearer', 'expires_in': 999999999, 'expires_at': 4102444800}}},
        {'id': 'reviewHeader', 'name': 'SYNTHETIC REVIEW ONLY', 'type': 'httpHeaderAuth', 'data': {'name': 'X-Daubert-Automation-Token', 'value': PASSWORD}}
    ]
    (root / 'credentials.json').write_text(json.dumps(creds))
    source_filter = next(n for n in parent['nodes'] if n['name'] == '¿Correo válido de pagos?')['parameters']['conditions']['conditions'][0]['leftValue']
    allowed_domain = re.search(r'endsWith\("(@[^"]+)"\)', source_filter)
    assert allowed_domain, 'Expected the unchanged sender domain filter'
    (root / 'scenario.json').write_text(json.dumps({'messages': [], 'sender': 'synthetic' + allowed_domain.group(1)}))
    for folder in ['n8n-home', 'zips', 'dropbox', 'dropbox/HERRAMIENTAS AUTOMATIZACION/NOTIFICACIONES DE PAGO/05_ARCHIVOS AUXILIARES/FIRMA']:
        (root / folder).mkdir(parents=True, exist_ok=True)
    png = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082')
    signature = root / 'dropbox/HERRAMIENTAS AUTOMATIZACION/NOTIFICACIONES DE PAGO/05_ARCHIVOS AUXILIARES/FIRMA'
    for name in ('logo', 'linkedin', 'google', 'facebook', 'twitter'):
        (signature / (name + '.png')).write_bytes(png)


def setup(root):
    # Never adopt/restart/delete an existing container or network.
    assert docker('ps', '-a', '--filter', 'name=' + PREFIX, '--format', '{{.Names}}').stdout.strip() == b'', 'Rehearsal containers already exist; inspect before continuing'
    docker('network', 'create', '--internal', '--label', 'daubert.rehearsal=pr17', NET)
    docker('run', '-d', '--name', PG, '--label', 'daubert.rehearsal=pr17', '--network', NET,
           '-e', 'POSTGRES_PASSWORD=' + PASSWORD, '-e', 'POSTGRES_DB=daubert_global', 'postgres:18-alpine')
    wait(lambda: docker('exec', PG, 'pg_isready', '-U', 'postgres', check=False).returncode == 0, label='sandbox PostgreSQL')
    roles = json.loads((root / 'roles.json').read_text())
    sql('\n'.join('CREATE ROLE "' + r.replace('"', '""') + '";' for r in roles))
    sql(f"ALTER ROLE n8n_app LOGIN PASSWORD '{PASSWORD}'; ALTER ROLE daubert_hub_app LOGIN PASSWORD '{PASSWORD}';")
    sql((root / 'schema.sql').read_text(encoding='utf-8'))
    assert rows('SELECT count(*) AS n FROM core.correos_notificacion_pago')[0]['n'] == 0
    result = sql((REPO / 'database/migrations/daubert_global/20261023_019_payment_file_recovery_prod.precheck.sql').read_text())
    assert result.returncode == 0
    sql((REPO / 'database/migrations/daubert_global/20261023_019_payment_file_recovery_prod.up.sql').read_text())
    sql((REPO / 'database/migrations/daubert_global/20261023_019_payment_file_recovery_prod.postcheck.sql').read_text())
    # Exercise DOWN before any jobs; restore original function bodies and keep evidence objects.
    down = sql((REPO / 'database/migrations/daubert_global/20261023_019_payment_file_recovery_prod.down.sql').read_text(), check=False)
    (root / 'initial-down.txt').write_bytes(down.stdout + down.stderr)
    if down.returncode:
        raise AssertionError('INITIAL DOWN FAILED: ' + (down.stdout + down.stderr).decode('utf-8', 'replace')[-1500:])
    # Reload the disposable baseline, not an in-place deletion of business evidence.
    docker('exec', PG, 'dropdb', '-U', 'postgres', 'daubert_global')
    docker('exec', PG, 'createdb', '-U', 'postgres', 'daubert_global')
    sql((root / 'schema.sql').read_text(encoding='utf-8'))
    sql((REPO / 'database/migrations/daubert_global/20261023_019_payment_file_recovery_prod.up.sql').read_text())
    for table, column in [('core.empresas', 'empresa_id'), ('core.correos_notificacion_pago', 'correo_id'), ('core.archivos_notificacion_pago', 'archivo_id')]:
        sql(f"SELECT setval(pg_get_serial_sequence('{table}','{column}'),10000,false);")
    command(['C:/Program Files/Git/usr/bin/openssl.exe', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(root / 'key.pem'), '-out', str(root / 'cert.pem'), '-days', '2', '-subj', '/CN=graph.microsoft.com'])
    mount = f'{root}:/data/review'
    docker('run', '-d', '--name', GRAPH, '--label', 'daubert.rehearsal=pr17', '--network', NET, '--network-alias', 'graph.microsoft.com',
           '-v', mount, '-v', f'{REPO / "scripts/n8n/payment-recovery-graph-double.cjs"}:/app/double.cjs:ro', 'node:24-alpine', 'node', '/app/double.cjs')
    docker('run', '-d', '--name', N8N, '--label', 'daubert.rehearsal=pr17', '--network', NET, '-v', mount,
           '-v', f'{root / "n8n-home"}:/home/node/.n8n',
           '-e', 'N8N_ENCRYPTION_KEY=synthetic-review-only-encryption-key', '-e', 'N8N_SECURE_COOKIE=false',
           '-e', 'N8N_DIAGNOSTICS_ENABLED=false', '-e', 'N8N_VERSION_NOTIFICATIONS_ENABLED=false', '-e', 'N8N_TEMPLATES_ENABLED=false',
           '-e', 'N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=false', '-e', 'NODE_FUNCTION_ALLOW_BUILTIN=fs,path,crypto',
           '-e', 'NODE_FUNCTION_ALLOW_EXTERNAL=fflate', '-e', 'N8N_RESTRICT_FILE_ACCESS_TO=/data/review', '-e', 'NODE_TLS_REJECT_UNAUTHORIZED=0',
           'docker.n8n.io/n8nio/n8n:2.27.4')
    wait(lambda: docker('exec', N8N, 'node', '-e', "fetch('http://127.0.0.1:5678/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))", check=False).returncode == 0, timeout=90, label='sandbox n8n')
    wait(lambda: native_fetch(N8N, 'http://127.0.0.1:5678/rest/settings')['body'].startswith('{"data"'), label='n8n REST initialization')
    response = native_fetch(N8N, 'http://127.0.0.1:5678/rest/owner/setup', 'POST', {'email': 'review@example.test', 'firstName': 'Synthetic', 'lastName': 'Review', 'password': PASSWORD}, {'content-type': 'application/json'})
    assert response['status'] == 200, response['body']
    assert json.loads(response['body'])['data']['email'] == 'review@example.test'
    for filename, kind in [('credentials.json', 'credentials'), ('error.json', 'workflow'), ('child.json', 'workflow'), ('parent.json', 'workflow')]:
        docker('exec', N8N, 'n8n', 'import:' + kind, '--input=/data/review/' + filename)
    error_id = json.loads((root / 'error.json').read_text(encoding='utf-8'))['id']
    for wid in (error_id, CHILD, WORKFLOW):
        docker('exec', N8N, 'n8n', 'publish:workflow', '--id=' + wid)
    # Only this disposable container will restart to register the published Schedule/webhook.
    return True


def fixtures(root):
    companies = []
    for i in range(13):
        name = 'SYNTHETIC REVIEW COMPANY ' + chr(65 + i)
        cid = rows(f"INSERT INTO core.empresas(tipo_empresa,nombre_comercial,estatus,ruta_dropbox) VALUES ('PROVEEDOR','{name}','ACTIVO','PROVEEDORES/REVIEW_{i}') RETURNING empresa_id")[0]['empresa_id']
        sql(f"INSERT INTO core.empresa_roles(empresa_id,rol,estatus) VALUES ({cid},'PROVEEDOR','ACTIVO'); INSERT INTO core.empresas_notificacion_pago(empresa_id,procesa_comprobantes_pago,notificaciones_activas,ruta_destino) VALUES ({cid},true,true,'PROVEEDORES/REVIEW_{i}/PAGOS/{{ANIO}}/{{MES_NUM}}');")
        contact = rows(f"INSERT INTO core.contactos(empresa_id,tipo_contacto,nombre,estatus) VALUES ({cid},'PERSONA','Synthetic','ACTIVO') RETURNING contacto_id")[0]['contacto_id']
        sql(f"INSERT INTO core.medios_contacto(contacto_id,tipo_medio,valor,estatus,recibe_notificacion_pago,tipo_destinatario_pago) VALUES ({contact},'CORREO','supplier{i}@example.test','ACTIVO',true,'PARA');")
        (root / f'dropbox/PROVEEDORES/REVIEW_{i}').mkdir(parents=True, exist_ok=True)
        companies.append({'id': cid, 'name': name})
    return companies


def message(root, tag, names, visible=True):
    scenario_data = json.loads((root / 'scenario.json').read_text())
    existing = next((m for m in scenario_data['messages'] if m['id'] == tag), None)
    if existing:
        raw = (root / f'zips/{tag}.zip').read_bytes()
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            return {'message': existing, 'entries': [(name, z.read(name)) for name in z.namelist()], 'zipHash': digest(raw)}
    entries = [(name, pdf(tag + str(i))) for i, name in enumerate(names)]
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, data in entries: z.writestr(name, data)
    (root / f'zips/{tag}.zip').write_bytes(out.getvalue())
    m = {'id': tag, 'subject': 'PAGO PROVEEDORES S43 SYNTHETIC ' + tag, 'visible': visible}
    data = json.loads((root / 'scenario.json').read_text()); data['messages'].append(m)
    (root / 'scenario.json').write_text(json.dumps(data))
    return {'message': m, 'entries': entries, 'zipHash': digest(out.getvalue())}


def scenario(root, **changes):
    data = json.loads((root / 'scenario.json').read_text()); data.update(changes)
    pending = root / 'scenario.new'; pending.write_text(json.dumps(data)); pending.replace(root / 'scenario.json')


def setup_api(root):
    ip = json.loads(docker('inspect', N8N).stdout)[0]['NetworkSettings']['Networks'][NET]['IPAddress']
    docker('run', '-d', '--name', API, '--label', 'daubert.rehearsal=pr17', '--network', NET,
           '--add-host', 'host.docker.internal:' + ip,
           '-v', f'{REPO / "apps/api/dist"}:/app/apps/api/dist:ro',
           '-e', 'DB_HOST=' + PG, '-e', 'DB_PORT=5432', '-e', 'DB_NAME=daubert_global', '-e', 'DB_USER=daubert_hub_app', '-e', 'DB_PASSWORD=' + PASSWORD,
           '-e', 'AUTH_COOKIE_SECURE=false', '-e', 'APP_VERSION=ISOLATED-REHEARSAL', '-e', 'GIT_COMMIT=02d0b87',
           '-e', 'PAYMENT_FILE_ASSIGNMENTS_PROD_ENABLED=true', '-e', 'PAYMENT_FILE_ASSIGNMENTS_PROD_N8N_READY=true',
           '-e', 'PAYMENT_FILE_ASSIGNMENTS_PROD_N8N_ORIGIN=http://host.docker.internal:5678',
           '-e', 'PAYMENT_NOTIFICATIONS_REPROCESS_WEBHOOK_URL=http://host.docker.internal:5678/webhook/daubert-hub/notificaciones-pago/reprocesar',
           '-e', 'PAYMENT_NOTIFICATIONS_WEBHOOK_TOKEN=' + PASSWORD, 'daubert-hub-api:latest')
    wait(lambda: docker('exec', API, 'node', '-e', "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))", check=False).returncode == 0, label='isolated Hub API')
    hashed = docker('exec', API, 'node', '-e', "require('argon2').hash(process.argv[1]).then(x=>console.log(x))", PASSWORD).stdout.decode().strip()
    sql(f"INSERT INTO security.users(display_name,email,password_hash,role,status,must_change_password) VALUES ('Synthetic Review','review@example.test','{hashed}','ADMIN','ACTIVE',false);")


def api_cookie():
    response = native_fetch(API, 'http://127.0.0.1:3000/api/auth/login', 'POST', {'email': 'review@example.test', 'password': PASSWORD}, {'content-type': 'application/json'})
    assert response['status'] == 200, response['body']
    return response['headers']['set-cookie'].split(';')[0]


def api_request(cookie, route, method='GET', body=None):
    return native_fetch(API, 'http://127.0.0.1:3000/api' + route, method, body, {'content-type': 'application/json', 'cookie': cookie})


def n8n_request(route, method='GET', body=None):
    global N8N_COOKIE
    if N8N_COOKIE is None:
        login = native_fetch(N8N, 'http://127.0.0.1:5678/rest/login', 'POST', {'emailOrLdapLoginId': 'review@example.test', 'password': PASSWORD}, {'content-type': 'application/json'})
        assert login['status'] == 200, login['body']
        N8N_COOKIE = login['headers']['set-cookie'].split(';')[0]
    return native_fetch(N8N, 'http://127.0.0.1:5678/rest' + route, method, body, {'content-type': 'application/json', 'cookie': N8N_COOKIE})


def ingest_now():
    result = n8n_request('/workflows/' + WORKFLOW + '/run', 'POST', {'triggerToStartFrom': {'name': 'Schedule Trigger'}})
    assert result['status'] == 200, result['body']
    return json.loads(result['body'])


def complete(root, cid):
    wait(lambda: rows(f"SELECT * FROM core.recuperaciones_notificacion_pago WHERE correo_id={cid} AND estado='FINALIZADO'"), timeout=90, label='completed recovery')
    drain(root)


def json_payment_snapshot(cid, ids=None):
    condition = f'correo_id={cid}' + (f" AND empresa_id IN ({','.join(map(str, ids))})" if ids else '')
    return json.dumps({'results': rows('SELECT * FROM core.resultados_notificacion_pago WHERE ' + condition + ' ORDER BY empresa_id'),
                       'drafts': rows('SELECT * FROM core.borradores_notificacion_pago WHERE ' + condition + ' ORDER BY empresa_id')}, sort_keys=True)


def events(root):
    p = root / 'graph-events.jsonl'
    return [json.loads(line) for line in p.read_text().splitlines()] if p.exists() else []


def error_logs(root):
    result = []
    for p in (root / 'dropbox/HERRAMIENTAS AUTOMATIZACION/NOTIFICACIONES DE PAGO/03_LOGS').rglob('*.jsonl'):
        for line in p.read_text().splitlines():
            record = json.loads(line)
            if record.get('resultado') == 'ERROR_CRITICO': result.append(record)
    return result


def cases(root, private):
    report = {'candidateCommit': '02d0b87', 'cases': {}, 'isolation': {}}
    for container in (PG, N8N, GRAPH):
        info = json.loads(docker('inspect', container).stdout)[0]
        assert info['Config']['Labels']['daubert.rehearsal'] == 'pr17'
        assert set(info['NetworkSettings']['Networks']) == {NET}
        assert not info['HostConfig']['PortBindings']
    assert json.loads(docker('network', 'inspect', NET).stdout)[0]['Internal']
    report['isolation'] = {'internalNetwork': True, 'publishedHostPorts': 0, 'realGraphCredentials': False, 'realDropboxMount': False}
    company = json.loads((root / 'fixtures.json').read_text())['companies']
    # Complete synthetic weekly-program input; do not weaken the production FACTURAS validation.
    from openpyxl import Workbook
    from openpyxl.styles import Font
    weekly = root / 'dropbox/CXP/CXP/PROGRAMACIÓN SEMANAL/2026'; weekly.mkdir(parents=True, exist_ok=True)
    book = Workbook(); sheet = book.active
    sheet.append([None, None, None, None, None])
    for col in range(1, 6): sheet.cell(1, col).font = Font(bold=True)
    sheet.append([None, 'SEMANA 43'])
    for i, c in enumerate(company):
        sheet.append([c['name']]); sheet.append([f'INV-{i}', 46318, 'Synthetic invoice', 100, 'MN'])
    book.save(weekly / 'Programacion de Pagos Semana 43.xlsx')
    if not any(m['id'] == 'REVIEW_A_READY' for m in json.loads((root / 'scenario.json').read_text())['messages']):
        message(root, 'REVIEW_A_READY', [f'1.-{company[0]["name"]} READY A.pdf', f'2.-{company[1]["name"]} READY A.pdf', f'3.-{company[0]["name"]} READY A.pdf'])
    if not rows("SELECT correo_id FROM core.correos_notificacion_pago WHERE outlook_message_id='REVIEW_A_READY'"):
        ingest_now()
    wait(lambda: rows("SELECT correo_id FROM core.correos_notificacion_pago WHERE outlook_message_id='REVIEW_A_READY' AND estado<>'PENDIENTE'"), timeout=90, label='Schedule-path A')
    drain(root)
    ac = rows("SELECT correo_id,estado FROM core.correos_notificacion_pago WHERE outlook_message_id='REVIEW_A_READY'")[0]
    ar = rows(f"SELECT empresa_id,estado FROM core.resultados_notificacion_pago WHERE correo_id={ac['correo_id']}")
    assert len(ar) == 2 and all(x['estado'] == 'LISTO' for x in ar), ar
    assert len(rows(f"SELECT * FROM core.borradores_notificacion_pago WHERE correo_id={ac['correo_id']}")) == 2
    report['cases']['A'] = {'passed': True, 'mail': ac, 'results': ar, 'scheduleTriggerObserved': any(e['mode'] == 'trigger' and e['status'] == 'success' and e['workflowId'] == WORKFLOW for e in state(root))}
    print('PASS A actual Schedule, native Outlook/Graph nodes, three PDFs and two drafts', flush=True)
    if not docker('ps', '-a', '--filter', 'name=^/' + API + '$', '--format', '{{.Names}}').stdout.strip(): setup_api(root)
    cookie = api_cookie()
    b = message(root, 'REVIEW_B', [f'{i+1}.-{c["name"]} CASE B.pdf' for i, c in enumerate(company[:12])] + ['13.-UNKNOWN REVIEW ALIAS.pdf'])
    if not rows("SELECT correo_id FROM core.correos_notificacion_pago WHERE outlook_message_id='REVIEW_B'"):
        ingest_now()
    wait(lambda: rows("SELECT correo_id FROM core.correos_notificacion_pago WHERE outlook_message_id='REVIEW_B' AND estado='ERROR'"), timeout=90, label='Schedule-path B')
    drain(root)
    cid = rows("SELECT correo_id FROM core.correos_notificacion_pago WHERE outlook_message_id='REVIEW_B'")[0]['correo_id']
    fid = rows(f"SELECT archivo_id FROM core.archivos_notificacion_pago WHERE correo_id={cid} AND nombre_archivo='13.-UNKNOWN REVIEW ALIAS.pdf'")[0]['archivo_id']
    assert len(rows(f'SELECT * FROM core.resultados_notificacion_pago WHERE correo_id={cid}')) == 12
    assert len(rows(f'SELECT * FROM core.borradores_notificacion_pago WHERE correo_id={cid}')) == 12
    before = json_payment_snapshot(cid)
    file_before = rows(f"SELECT * FROM core.archivos_notificacion_pago WHERE correo_id={cid} AND archivo_id<>{fid} ORDER BY archivo_id")
    disk_before = {str(p): digest(p.read_bytes()) for p in (root / 'dropbox/PROVEEDORES').rglob('*.pdf')}
    report['cases']['B'] = {'passed': True, 'mailId': cid, 'fileId': fid, 'previousResults': 12, 'previousDrafts': 12}
    print('PASS B initial partial mail, 12 previous results/drafts and unknown alias', flush=True)
    r = api_request(cookie, f'/automations/payment-notifications/{cid}/reprocess', 'POST'); assert r['status'] == 202, r
    complete(root, cid)
    detail = json.loads(api_request(cookie, f'/automations/payment-notifications/{cid}')['body'])['data']
    point = next(x['fileAssignment'] for x in detail['fileErrorDetails'] if x['fileAssignment']['fileId'] == str(fid))
    assert point['canManage'] and point['operationalState'] == 'SIN_EFECTOS', point
    assert before == json_payment_snapshot(cid)
    assert file_before == rows(f"SELECT * FROM core.archivos_notificacion_pago WHERE correo_id={cid} AND archivo_id<>{fid} ORDER BY archivo_id")
    assert all(digest(Path(p).read_bytes()) == h for p, h in disk_before.items())
    aliases_before = rows('SELECT count(*) AS n FROM core.alias_empresa')[0]['n']
    r = api_request(cookie, f'/automations/payment-notifications/{cid}/files/{fid}/assignment', 'PATCH', {'action': 'ASSIGN', 'companyId': str(company[12]['id']), 'expectedVersion': 0, 'confirmed': True}); assert r['status'] == 200, r
    assert rows('SELECT count(*) AS n FROM core.alias_empresa')[0]['n'] == aliases_before
    assert rows(f"SELECT 1 FROM audit.cambios WHERE tabla='archivos_notificacion_pago' AND registro_id='archivo_id={fid}' AND datos_anteriores->>'estado_operativo'='REPROCESO_SOLICITADO' AND datos_nuevos->>'estado_operativo'='SIN_EFECTOS'")
    report['cases']['C'] = {'passed': True, 'rehabilitated': point, 'previousRowsAndBytesUnchanged': True, 'realHubAssignment': True, 'permanentAliasesUnchanged': True}
    print('PASS C real Hub -> parent -> child -> audited recovery -> real Hub assignment', flush=True)
    scenario(root, downloadDelayMs=500)
    start_events = len(events(root))
    with ThreadPoolExecutor(2) as executor:
        responses = list(executor.map(lambda _: api_request(cookie, f'/automations/payment-notifications/{cid}/reprocess', 'POST'), range(2)))
    assert sorted(r['status'] for r in responses) == [202, 409], responses
    complete(root, cid); scenario(root, downloadDelayMs=0)
    target = company[12]['id']
    assert rows(f'SELECT count(*) AS n FROM core.resultados_notificacion_pago WHERE correo_id={cid} AND empresa_id={target}')[0]['n'] == 1
    assert rows(f'SELECT count(*) AS n FROM core.borradores_notificacion_pago WHERE correo_id={cid} AND empresa_id={target}')[0]['n'] == 1
    assert before == json_payment_snapshot(cid, [c['id'] for c in company[:12]])
    added = events(root)[start_events:]
    assert len([e for e in added if e.get('effect') == 'draft_created']) == 1
    assert len([e for e in added if e.get('effect') == 'attachment_added' and not e['inline']]) == 1
    report['cases']['D'] = {'passed': True, 'httpStatuses': sorted(r['status'] for r in responses), 'newDrafts': 1, 'newPdfAttachments': 1}
    print('PASS D two concurrent Hub requests: 202/409, one draft and PDF attachment', flush=True)
    (root / 'report.json').write_text(json.dumps(report, indent=2))


def all_payments(database='daubert_global'):
    return {table: rows(f'SELECT * FROM core.{table} ORDER BY 1', database) for table in (
        'correos_notificacion_pago', 'archivos_notificacion_pago', 'asignaciones_archivo_notificacion_pago',
        'resultados_notificacion_pago', 'borradores_notificacion_pago', 'recuperaciones_notificacion_pago')}


def topology(private):
    child = json.loads((private / 'payment-recovery-prod-child.json').read_text(encoding='utf-8'))
    by_name = {n['name']: n for n in child['nodes']}
    reachable = set(); queue = ['Entrada recuperacion']
    while queue:
        name = queue.pop()
        if name in reachable: continue
        reachable.add(name)
        for output in child['connections'].get(name, {}).get('main', []):
            queue.extend(c['node'] for c in output)
    needed = set(reachable)
    while True:
        refs = set()
        for name in needed:
            params = json.dumps(by_name[name]['parameters'], ensure_ascii=False)
            refs.update(m.group(1).rstrip('\\') for m in re.finditer(r'''\$\(\\?["']([^"']+?)\\?["']\)''', params))
            refs.update(m.group(1).rstrip('\\') for m in re.finditer(r'''\$node\[\\?["']([^"']+?)\\?["']\]''', params))
            refs.update(m.group(1).rstrip('\\') for m in re.finditer(r'''\$items\(\\?["']([^"']+?)\\?["']''', params))
        updated = needed | (refs & by_name.keys())
        if updated == needed: break
        needed = updated
    return {'total': len(by_name), 'graphReachable': len(reachable), 'reachableAndNamedReferences': len(needed),
            'removableWithoutGraphOrNamedReferences': sorted(by_name.keys() - needed),
            'alternativeImplemented': False}


def wait_checks(root, report):
    runs = rows("SELECT correo_id,ejecucion_id,estado,updated_at FROM core.recuperaciones_notificacion_pago ORDER BY correo_id")
    proofs = []
    for run in runs:
        parent = next(e for e in state(root) if str(e['id']) == run['ejecucion_id'])
        rd = execution_data(root, parent['id'])['resultData']['runData']
        call = rd['Procesar reproceso y esperar'][0]
        confirm = rd['Confirmar fin de reproceso'][0]
        assert confirm['startTime'] >= call['startTime'] + call['executionTime']
        children = [e for e in state(root) if e['workflowId'] == CHILD and e['status'] == 'success'
                    and e['startedAt'] >= parent['startedAt'] and e['stoppedAt'] <= parent['stoppedAt']]
        assert children, (run, parent)
        proofs.append({'parent': parent['id'], 'children': [e['id'] for e in children], 'confirmAfterCallReturn': True, 'ownerState': run['estado']})
    report['waitProof'] = proofs


def rollback_and_failures(root, private, after_down=False):
    report = json.loads((root / 'report.json').read_text())
    company = json.loads((root / 'fixtures.json').read_text())['companies']
    if not after_down:
        cookie = api_cookie()
    # Legacy source: no individual registry, existing aggregate/draft, real old reprocess contract.
    if not after_down:
        message(root, 'REVIEW_LEGACY', [f'1.-{company[0]["name"]} LEGACY.pdf'], visible=False)
        lc = rows("INSERT INTO core.correos_notificacion_pago(outlook_message_id,estado) VALUES ('REVIEW_LEGACY','ERROR') RETURNING correo_id")[0]['correo_id']
        sql(f"INSERT INTO core.resultados_notificacion_pago(correo_id,empresa_id,estado,motivo) VALUES ({lc},{company[0]['id']},'MANUAL','FACTURAS'); INSERT INTO core.borradores_notificacion_pago(correo_id,empresa_id,estado,outlook_draft_id) VALUES ({lc},{company[0]['id']},'CREADO','SYNTHETIC-LEGACY-DRAFT');")
        r = api_request(cookie, f'/automations/payment-notifications/{lc}/reprocess', 'POST'); assert r['status'] == 202, r
        complete(root, lc)
    else:
        lc = rows("SELECT correo_id FROM core.correos_notificacion_pago WHERE outlook_message_id='REVIEW_LEGACY'")[0]['correo_id']
    assert rows(f'SELECT count(*) AS n FROM core.borradores_notificacion_pago WHERE correo_id={lc}')[0]['n'] == 1
    assert rows(f'SELECT outlook_draft_id FROM core.borradores_notificacion_pago WHERE correo_id={lc}')[0]['outlook_draft_id'] == 'SYNTHETIC-LEGACY-DRAFT'
    report['legacy'] = {'passed': True, 'mailId': lc, 'originalDraftReused': True, 'row': rows(f'SELECT estado,motivo FROM core.resultados_notificacion_pago WHERE correo_id={lc}')}
    print('PASS historical mail without file registry uses existing draft without duplication', flush=True)
    wait_checks(root, report)
    report['topology'] = topology(private)

    # Coordinated rollback: close entries and drain first, then restore SQL and the old workflow/Hub.
    if not after_down:
        r = n8n_request('/workflows/' + WORKFLOW + '/deactivate', 'POST'); assert r['status'] == 200, r
        drain(root)
        gate = native_fetch(API, 'http://host.docker.internal:5678/webhook/daubert-hub/notificaciones-pago/reprocesar', 'POST', {'correo_id': lc}, {'content-type': 'application/json', 'X-Daubert-Automation-Token': PASSWORD})
        assert gate['status'] == 404, gate
        docker('stop', API)
        before = all_payments()
        backup = docker('exec', PG, 'pg_dump', '-U', 'postgres', '-d', 'daubert_global', '-Fc').stdout
        (root / 'synthetic-checkpoint.dump').write_bytes(backup)
        sql((REPO / 'database/migrations/daubert_global/20261023_019_payment_file_recovery_prod.down.sql').read_text())
        assert before == all_payments()
    else:
        backup = (root / 'synthetic-checkpoint.dump').read_bytes()
        docker('exec', PG, 'createdb', '-U', 'postgres', 'review_checkpoint')
        docker('exec', '-i', PG, 'pg_restore', '-U', 'postgres', '-d', 'review_checkpoint', data=backup)
        before = all_payments('review_checkpoint'); assert before == all_payments()
        cookie = ''
    before_bytes = {str(p): digest(p.read_bytes()) for p in (root / 'dropbox').rglob('*.pdf')}
    baseline, _ = adapt(json.loads((private / 'payment-production-source.json').read_text(encoding='utf-8')), root)
    (root / 'baseline-parent.json').write_text(json.dumps(baseline, ensure_ascii=False), encoding='utf-8')
    docker('exec', N8N, 'n8n', 'import:workflow', '--input=/data/review/baseline-parent.json')
    docker('exec', N8N, 'n8n', 'publish:workflow', '--id=' + WORKFLOW)
    docker('restart', N8N)
    wait(lambda: docker('exec', N8N, 'node', '-e', "fetch('http://127.0.0.1:5678/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))", check=False).returncode == 0)
    ip = json.loads(docker('inspect', N8N).stdout)[0]['NetworkSettings']['Networks'][NET]['IPAddress']
    old_api = API + '-old'
    docker('run', '-d', '--name', old_api, '--label', 'daubert.rehearsal=pr17', '--network', NET,
           '--add-host', 'host.docker.internal:' + ip,
           '-e', 'DB_HOST=' + PG, '-e', 'DB_PORT=5432', '-e', 'DB_NAME=daubert_global', '-e', 'DB_USER=daubert_hub_app', '-e', 'DB_PASSWORD=' + PASSWORD,
           '-e', 'AUTH_COOKIE_SECURE=false', '-e', 'PAYMENT_FILE_ASSIGNMENTS_PROD_ENABLED=true',
           '-e', 'PAYMENT_FILE_ASSIGNMENTS_PROD_N8N_READY=true', '-e', 'PAYMENT_FILE_ASSIGNMENTS_PROD_N8N_ORIGIN=http://host.docker.internal:5678',
           '-e', 'PAYMENT_NOTIFICATIONS_REPROCESS_WEBHOOK_URL=http://host.docker.internal:5678/webhook/daubert-hub/notificaciones-pago/reprocesar',
           '-e', 'PAYMENT_NOTIFICATIONS_WEBHOOK_TOKEN=' + PASSWORD, 'daubert-hub-api:latest')
    wait(lambda: docker('exec', old_api, 'node', '-e', "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))", check=False).returncode == 0)
    login_old = native_fetch(old_api, 'http://127.0.0.1:3000/api/auth/login', 'POST', {'email':'review@example.test','password':PASSWORD}, {'content-type':'application/json'})
    cookie_old = login_old['headers']['set-cookie'].split(';')[0]
    read_old = native_fetch(old_api, f'http://127.0.0.1:3000/api/automations/payment-notifications/{report["cases"]["B"]["mailId"]}', headers={'cookie': cookie_old})
    assert read_old['status'] == 200, read_old
    assert before == all_payments() and all(digest(Path(p).read_bytes()) == h for p, h in before_bytes.items())
    report['rollback'] = {'passed': True, 'closedWebhookStatus': 404, 'drained': True, 'downWithData': True,
                          'previousHubReads': 200, 'paymentRowsAndPdfBytesUnchanged': True, 'initialCleanDownPassed': True}
    print('PASS close/drain/DOWN/previous workflow+Hub restore with identical payment rows and PDF bytes', flush=True)
    (root / 'report.json').write_text(json.dumps(report, indent=2))

    # Reset ONLY the disposable rehearsal to its synthetic checkpoint to continue failure tests.
    docker('stop', old_api); docker('stop', N8N)
    docker('exec', PG, 'dropdb', '--force', '-U', 'postgres', 'daubert_global'); docker('exec', PG, 'createdb', '-U', 'postgres', 'daubert_global')
    docker('exec', '-i', PG, 'pg_restore', '-U', 'postgres', '-d', 'daubert_global', data=backup)
    docker('start', N8N)
    wait(lambda: docker('exec', N8N, 'node', '-e', "fetch('http://127.0.0.1:5678/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))", check=False).returncode == 0)
    docker('exec', N8N, 'n8n', 'import:workflow', '--input=/data/review/parent.json'); docker('exec', N8N, 'n8n', 'publish:workflow', '--id=' + WORKFLOW)
    docker('restart', N8N); docker('start', API)
    wait(lambda: docker('exec', N8N, 'node', '-e', "fetch('http://127.0.0.1:5678/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))", check=False).returncode == 0)
    failure_cases(root)


def failure_cases(root):
    report = json.loads((root / 'report.json').read_text())
    cookie = api_cookie()
    # Health starts responding before n8n finishes registering active webhooks.
    wait(lambda: native_fetch(API, 'http://host.docker.internal:5678/webhook/daubert-hub/notificaciones-pago/reprocesar', 'POST', {}, {'content-type':'application/json'})['status'] == 403,
         timeout=30, label='active webhook authentication gate')
    report['activationReadiness'] = {'healthAloneInsufficient': True, 'unauthenticatedWebhook': 403,
                                    'earlyRequestObserved502AndRetainedRequestedOwner': bool(rows("SELECT 1 FROM core.recuperaciones_notificacion_pago r JOIN core.correos_notificacion_pago c USING(correo_id) WHERE c.outlook_message_id='REVIEW_E' AND r.estado='SOLICITADO' AND r.ejecucion_id IS NULL"))}
    def failed_fixture(tag):
        item = message(root, tag, ['1.-UNKNOWN REVIEW FAILURE.pdf'], visible=False)
        cid = rows(f"INSERT INTO core.correos_notificacion_pago(outlook_message_id,estado) VALUES ('{tag}','PENDIENTE') RETURNING correo_id")[0]['correo_id']
        sql(f"SELECT core.fn_registrar_archivo_notificacion_pago({cid},'ATT-{tag}','{item['zipHash']}',0,'{digest(item['entries'][0][1])}','1.-UNKNOWN REVIEW FAILURE.pdf','UNKNOWN REVIEW FAILURE','ALIAS_NO_CATALOGADO',true,true);")
        sql(f"UPDATE core.correos_notificacion_pago SET estado='ERROR',detalle_error='1.-UNKNOWN REVIEW FAILURE.pdf: ALIAS_NO_CATALOGADO - UNKNOWN REVIEW FAILURE | HASH={digest(item['entries'][0][1])}' WHERE correo_id={cid};")
        return cid
    ec = failed_fixture('REVIEW_E_READY'); scenario(root, failMessage='REVIEW_E_READY')
    start_eid = max(x['id'] for x in state(root)); log_before = len(error_logs(root)); graph_before = len(events(root))
    r = api_request(cookie, f'/automations/payment-notifications/{ec}/reprocess', 'POST'); assert r['status'] == 202, r
    wait(lambda: len([e for e in state(root) if e['id'] > start_eid and e['status'] == 'error' and e['workflowId'] in (WORKFLOW, CHILD)]) == 2, timeout=90, label='parent and child errors')
    drain(root); scenario(root, failMessage=None)
    e_runs = [e for e in state(root) if e['id'] > start_eid]
    e_logs = error_logs(root)[log_before:]
    assert rows(f'SELECT estado FROM core.recuperaciones_notificacion_pago WHERE correo_id={ec}')[0]['estado'] == 'PROCESANDO'
    assert not [e for e in events(root)[graph_before:] if e.get('effect') == 'summary_sent']
    report['cases']['E'] = {'passed': True, 'parentAndChildFailed': True, 'executions': e_runs,
                            'criticalRecords': [{k: r.get(k) for k in ('execution_id','workflow_id','nodo_fallido')} for r in e_logs],
                            'realErrorWorkflowHasNotificationNodes': False, 'summaryDeliveries': 0}
    print('PASS E child failure propagated; critical log records:', len(e_logs), flush=True)
    fc = failed_fixture('REVIEW_F_READY'); scenario(root, blockMessage='REVIEW_F_READY')
    r = api_request(cookie, f'/automations/payment-notifications/{fc}/reprocess', 'POST'); assert r['status'] == 202, r
    wait(lambda: any(e.get('blocked') == 'REVIEW_F_READY' for e in events(root)), label='blocked child transport')
    docker('stop', '--time', '1', N8N); scenario(root, blockMessage=None)
    assert rows(f'SELECT estado FROM core.recuperaciones_notificacion_pago WHERE correo_id={fc}')[0]['estado'] == 'PROCESANDO'
    assert not rows(f'SELECT 1 FROM core.archivos_notificacion_pago WHERE correo_id={fc} AND sin_efectos_ejecucion IS NOT NULL')
    retry = api_request(cookie, f'/automations/payment-notifications/{fc}/reprocess', 'POST'); assert retry['status'] == 409, retry
    blocked_down = sql((REPO / 'database/migrations/daubert_global/20261023_019_payment_file_recovery_prod.down.sql').read_text(), check=False)
    assert blocked_down.returncode and b'Unresolved processing owner' in blocked_down.stderr
    report['cases']['F'] = {'passed': True, 'ownerStillProcessing': True, 'fabricatedEvidence': False, 'retryStatus': 409, 'downRefusesUnresolvedOwner': True}
    report['realOutboundDeliveries'] = 0
    (root / 'report.json').write_text(json.dumps(report, indent=2))
    print('PASS F interrupted owner remains closed; no confirmation; retry and DOWN rejected', flush=True)


def activation_and_manual(root, private):
    report = json.loads((root / 'report.json').read_text())
    docker('start', N8N)
    wait(lambda: docker('exec', N8N, 'node', '-e', "fetch('http://127.0.0.1:5678/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))", check=False).returncode == 0)
    wait(lambda: native_fetch(N8N, 'http://127.0.0.1:5678/rest/settings')['body'].startswith('{"data"'), label='n8n REST initialization')
    wait(lambda: n8n_request('/workflows/' + WORKFLOW)['status'] == 200)
    assert n8n_request('/workflows/' + WORKFLOW + '/deactivate', 'POST')['status'] == 200
    drain(root)
    unknown = native_fetch(API, 'http://host.docker.internal:5678/webhook/daubert-hub/notificaciones-pago/reprocesar', 'POST', {}, {'content-type':'application/json'})
    assert unknown['status'] == 404
    current = json.loads(n8n_request('/workflows/' + WORKFLOW)['body'])['data']
    item = message(root, 'REVIEW_MANUAL', ['1.-UNKNOWN MANUAL REVIEW.pdf'], visible=False)
    existing = rows("SELECT correo_id FROM core.correos_notificacion_pago WHERE outlook_message_id='REVIEW_MANUAL'")
    if existing:
        cid = existing[0]['correo_id']
    else:
        cid = rows("INSERT INTO core.correos_notificacion_pago(outlook_message_id,estado) VALUES ('REVIEW_MANUAL','PENDIENTE') RETURNING correo_id")[0]['correo_id']
        sql(f"SELECT core.fn_registrar_archivo_notificacion_pago({cid},'ATT-REVIEW_MANUAL','{item['zipHash']}',0,'{digest(item['entries'][0][1])}','1.-UNKNOWN MANUAL REVIEW.pdf','UNKNOWN MANUAL REVIEW','ALIAS_NO_CATALOGADO',true,true); UPDATE core.correos_notificacion_pago SET estado='ERROR',detalle_error='1.-UNKNOWN MANUAL REVIEW.pdf: ALIAS_NO_CATALOGADO - UNKNOWN MANUAL REVIEW | HASH={digest(item['entries'][0][1])}' WHERE correo_id={cid};")
    selector = next(n for n in current['nodes'] if n['name'] == 'Seleccionar correo a reprocesar')
    selector['parameters']['assignments']['assignments'][0]['value'] = cid  # Synthetic operator input only.
    body = {k: current[k] for k in ('name','nodes','connections','settings','versionId')}
    patched = n8n_request('/workflows/' + WORKFLOW, 'PATCH', body); assert patched['status'] == 200, patched
    version = json.loads(patched['body'])['data']['versionId']
    activated = n8n_request('/workflows/' + WORKFLOW + '/activate', 'POST', {'versionId':version}); assert activated['status'] == 200, activated
    ready = native_fetch(API, 'http://host.docker.internal:5678/webhook/daubert-hub/notificaciones-pago/reprocesar', 'POST', {}, {'content-type':'application/json'}); assert ready['status'] == 403, ready
    run = n8n_request('/workflows/' + WORKFLOW + '/run', 'POST', {'triggerToStartFrom':{'name':'Reprocesar correo manual'}}); assert run['status'] == 200, run
    complete(root,cid)
    record = rows(f"SELECT f.estado_operativo,core.fn_archivo_notificacion_asignable(f.archivo_id,f.correo_id,false) AS safe FROM core.archivos_notificacion_pago f WHERE correo_id={cid}")[0]
    assert record['safe'] and record['estado_operativo'] == 'SIN_EFECTOS'
    report['manualEntry'] = {'passed':True,'mailId':cid,'realParentAndChild':True,'onlySelectorInputChanged':True}
    report['activationReadiness']['nativeApiPublishWithoutServiceRestart'] = True
    report['activationReadiness']['closed404ThenActivated403'] = True
    report['topology'] = topology(private)
    report['cases']['F']['stillBlockedAfterN8nRestart'] = bool(rows("SELECT 1 FROM core.recuperaciones_notificacion_pago r JOIN core.correos_notificacion_pago c USING(correo_id) WHERE c.outlook_message_id='REVIEW_F_READY' AND r.estado='PROCESANDO'"))
    (root/'report.json').write_text(json.dumps(report,indent=2))
    print('PASS native publish/unpublish readiness 404->403, manual entry and crash owner still closed after restart',flush=True)


def rollback_without_restart(root):
    report = json.loads((root / 'report.json').read_text())
    assert n8n_request('/workflows/' + WORKFLOW + '/deactivate', 'POST')['status'] == 200
    drain(root); docker('stop', API)
    interrupted = all_payments()
    exists = docker('exec', PG, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-At', '-c', "SELECT 1 FROM pg_database WHERE datname='review_checkpoint'").stdout.strip()
    if not exists:
        docker('exec', PG, 'createdb', '-U', 'postgres', 'review_checkpoint')
        docker('exec', '-i', PG, 'pg_restore', '-U', 'postgres', '-d', 'review_checkpoint', data=(root/'synthetic-checkpoint.dump').read_bytes())
    # Parallel test branch: preserve the entire interrupted database, never clear its owners.
    before_runtime = json.loads(docker('inspect', N8N).stdout)[0]['State']['StartedAt']
    active = docker('exec', PG, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-At', '-c', "SELECT count(*) FROM pg_stat_activity WHERE datname IN ('daubert_global','review_checkpoint')").stdout.decode().strip()
    assert active == '0', 'Database fork requires idle/disconnected application clients'
    docker('exec', PG, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'ALTER DATABASE daubert_global RENAME TO review_interrupted; ALTER DATABASE review_checkpoint RENAME TO daubert_global;')
    before = all_payments()
    sql((REPO / 'database/migrations/daubert_global/20261023_019_payment_file_recovery_prod.down.sql').read_text())
    with closing(sqlite3.connect((root / 'n8n-home/database.sqlite').as_uri()+'?mode=ro',uri=True)) as c:
        c.execute('PRAGMA query_only=ON')
        version = c.execute("SELECT versionId FROM workflow_history WHERE workflowId=? AND json_array_length(nodes)=108 ORDER BY createdAt DESC LIMIT 1",(WORKFLOW,)).fetchone()[0]
    r = n8n_request('/workflows/' + WORKFLOW + '/activate', 'POST', {'versionId': version}); assert r['status'] == 200, r
    gate = native_fetch(N8N, 'http://127.0.0.1:5678/webhook/daubert-hub/notificaciones-pago/reprocesar', 'POST', {}, {'content-type':'application/json'}); assert gate['status'] == 403
    docker('start', API + '-old')
    wait(lambda: docker('exec', API + '-old', 'node', '-e', "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",check=False).returncode==0)
    login = native_fetch(API+'-old','http://127.0.0.1:3000/api/auth/login','POST',{'email':'review@example.test','password':PASSWORD},{'content-type':'application/json'})
    cookie=login['headers']['set-cookie'].split(';')[0]
    data=native_fetch(API+'-old',f'http://127.0.0.1:3000/api/automations/payment-notifications/{report["cases"]["B"]["mailId"]}',headers={'cookie':cookie});assert data['status']==200
    assert before == all_payments()
    assert interrupted == all_payments('review_interrupted')
    assert before_runtime == json.loads(docker('inspect',N8N).stdout)[0]['State']['StartedAt']
    report['rollback']['nativePublicationRollbackWithoutN8nRestart'] = True
    report['rollback']['interruptedBranchPreservedWithoutOwnerReset'] = True
    report['rollback']['oldPublishedVersionRestored'] = version
    (root/'report.json').write_text(json.dumps(report,indent=2))
    print('PASS native version rollback without n8n restart; clean branch rows unchanged; interrupted branch preserved',flush=True)



def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root'); parser.add_argument('private_candidates'); parser.add_argument('--setup', action='store_true'); parser.add_argument('--cases', action='store_true'); parser.add_argument('--failures', action='store_true'); parser.add_argument('--after-down', action='store_true'); parser.add_argument('--only-failures', action='store_true'); parser.add_argument('--manual', action='store_true'); parser.add_argument('--native-rollback', action='store_true')
    args = parser.parse_args(); root = Path(args.root).resolve(); private = Path(args.private_candidates).resolve()
    approved_scratch = (Path(os.environ['LOCALAPPDATA']) / 'Temp/opencode').resolve()
    assert approved_scratch in root.parents, 'Rehearsal writes/mounts must stay in the approved scratch directory'
    assert root.is_dir() and (root / 'schema.sql').is_file()
    for child in ('n8n-home', 'dropbox', 'zips'):
        assert root in (root / child).resolve().parents, 'No junction/symlink to real n8n or Dropbox data'
    if args.setup:
        assert docker('ps', '-a', '--filter', 'name=' + PREFIX, '--format', '{{.Names}}').stdout.strip() == b'', 'Never overwrite an existing rehearsal'
        prepare(root, private)
        if not setup(root): return
        companies = fixtures(root)
        a = message(root, 'REVIEW_A', [f'1.-{companies[0]["name"]}.pdf', f'2.-{companies[1]["name"]}.pdf', f'3.-{companies[0]["name"]}.pdf'])
        (root / 'fixtures.json').write_text(json.dumps({'companies': companies, 'A': {'message': a['message']}}))
        docker('restart', N8N)
        wait(lambda: rows("SELECT correo_id FROM core.correos_notificacion_pago WHERE outlook_message_id='REVIEW_A' AND estado<>'PENDIENTE'"), timeout=360, label='original Schedule normal ingestion')
        drain(root)
        print('A MAIL', rows("SELECT correo_id,estado,detalle_error FROM core.correos_notificacion_pago WHERE outlook_message_id='REVIEW_A'"), flush=True)
        print('A RESULTS', rows('SELECT empresa_id,estado,motivo FROM core.resultados_notificacion_pago'), flush=True)
        print('A EXECUTIONS', state(root), flush=True)
    if args.cases:
        cases(root, private)
    if args.failures:
        rollback_and_failures(root, private, args.after_down)
    if args.only_failures:
        failure_cases(root)
    if args.manual:
        activation_and_manual(root, private)
    if args.native_rollback:
        rollback_without_restart(root)


if __name__ == '__main__':
    main()
