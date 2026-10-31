import json, os, re
base=os.path.dirname(os.path.abspath(__file__))
p=os.path.expanduser('~/.config/ZaloData/userscripts.json')
try: data=json.load(open(p))
except Exception: data={'version':1,'scripts':[]}
code=open(os.path.join(base,'ZaSetup.user.js'),encoding='utf-8').read()
import re as _re
m=_re.search(r'@version\s+([^\s]+)', code)
ver=m.group(1) if m else '1.3.2'
scripts=[s for s in data.get('scripts',[]) if s.get('name')!='ZaSetup']
scripts.append({'id':'zasetup','name':'ZaSetup','description':'ZaDark setup: quyền riêng tư + âm thanh','version':ver,'enabled':True,'code':code,'metadata':{'name':'ZaSetup','description':'ZaDark setup: quyền riêng tư + âm thanh','version':ver},'createdAt':'2026-10-31T00:00:00Z','updatedAt':'2026-10-31T00:00:00Z'})
data['scripts']=scripts
os.makedirs(os.path.dirname(p),exist_ok=True)
json.dump(data,open(p,'w'),ensure_ascii=False,indent=2)
print('ZaSetup userscript installed')
