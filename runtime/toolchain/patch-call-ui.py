#!/usr/bin/env python3
"""patch-call-ui.py — mở khoá toàn bộ Call UI & Call Signaling Queue trên Linux.

Bối cảnh:
  1. `isSupport()` / `isSupportVideoCall()` trong 4 bundle `pc-dist` kiểm tra
     Darwin kernel >= 17 (`os.release()`) và cờ `enable_mac_call` -> trả về false
     trên Linux (biến minified là `se` hoặc `ie` tuỳ bundle).
  2. `canUseIpcCall()` phụ thuộc `enable_ipc_call` từ server; nếu false thì
     `_sendToNative` gắn `e._optional = true`, khiến `main.js` không spawn `zcall-engine`.
  3. `using_queue: 1` làm nghẽn hàng đợi gửi tín hiệu `call-send-signal`.
  4. `preload-sqlite.js` cần mở `enableCall`, `enableVideoCall` và group call flags.

Idempotent: kiểm tra từng mẫu trước khi thay; chạy `node --check` trước khi ghi đè.
"""

from __future__ import annotations

import glob
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP = Path(os.environ.get("ZALO_APP_DIR") or (ROOT / "build" / "app-extracted"))
PC_DIST = APP / "pc-dist"
PRELOAD_SQLITE = APP / "main-dist" / "preload-sqlite.js"


def fail(msg: str) -> None:
    print(f"patch-call-ui: LỖI: {msg}", file=sys.stderr)
    raise SystemExit(1)


def node_check(path: Path) -> None:
    node = shutil.which("node")
    if not node:
        return
    res = subprocess.run([node, "--check", str(path)], capture_output=True, text=True)
    if res.returncode != 0:
        fail(f"node --check thất bại cho {path}:\n{res.stderr.strip()}")


def atomic_write(path: Path, text: str) -> None:
    fd, name = tempfile.mkstemp(prefix=path.name + ".", suffix=".js", dir=str(path.parent))
    tmp = Path(name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        shutil.copymode(path, tmp)
        node_check(tmp)
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()


RE_IS_SUPPORT = re.compile(
    r"isSupport\(\)\{return!!A\.default\.enable_mac_call&&\(A\.default\.enableCall&&[A-Za-z_$][\w$]*\)\}"
    r"isSupportVideoCall\(\)\{return this\.isSupport\(\)&&A\.default\.enableVideoCall\}"
)
RE_QUEUE_STATE = re.compile(
    r'([A-Za-z_$][\w$]*)="running",([A-Za-z_$][\w$]*)="pause",([A-Za-z_$][\w$]*)=3e4;'
    r"function ([A-Za-z_$][\w$]*)\(e=\{\}\)\{const\{limit:t=1/0,maxTimeout:n=\3\}=e,a=\[\];let ([A-Za-z_$][\w$]*);"
)
RE_REQ_DEQUEUE = re.compile(
    r"(this\.sendLogEndCallTimerId=null,this\.requestQueue=[A-Za-z_$][\w$]*\(\)),(this\.retryQueue=\[\])"
)
RE_SIG_HEAD = re.compile(
    r"AdvancedOptionsFromNative\(n\)\}\}handleSendSignal\(e,t,n\)\{let a,([A-Za-z_$][\w$]*);"
    r'switch\(this\.logInfo\("call-send-signal",JSON\.stringify\(n\)\),t\)\{'
)
RE_SIG_TAIL = re.compile(
    r"if\(a\)if\((?:!1&&)?A\.default\.call\.using_queue\)\{const e=\{task:a\};"
    r"k\(this\.requestQueue,e\)\.then\(\(e=>\{const n=e\.data;this\.handleRecvSignal\(t,\.\.\.n\)\}\)\)"
    r"\.catch\(\(e=>\{var a;this\.handleSendSignalError\(t,null===\(a=e\.error\)\|\|void 0===a\?void 0:a\[0\],"
    r"\{onSuccess:this\.handleRecvSignal\.bind\(this,t\),callId:n\.callId,callback:([A-Za-z_$][\w$]*)\}\)\}\)\)\}"
    r"else a\.then\(this\.handleRecvSignal\.bind\(this\.handleRecvSignal,t\)\)"
    r"\.catch\(\(e=>\{this\.handleSendSignalError\(t,e,"
    r"\{onSuccess:this\.handleRecvSignal\.bind\(this,t\),callId:n\.callId,callback:\1\}\)\}\)\)\}"
    r"handleSendSignalError\("
)
RE_GRP_FEATURES = re.compile(
    r't\.setttings\.features\.hasOwnProperty\("enable_group_call_for_user"\)'
    r'&&\(([A-Za-z_$][\w$]*)\.default\.enable_group_call_for_user=t\.setttings\.features\.enable_group_call_for_user\),'
    r't\.setttings\.features\.hasOwnProperty\("enable_group_call_entry_for_group"\)'
    r'&&\(\1\.default\.enable_group_call_entry_for_group=t\.setttings\.features\.enable_group_call_entry_for_group\),'
    r't\.setttings\.features\.hasOwnProperty\("group_call_max_users"\)'
    r'&&\(\1\.default\.group_call_max_users=t\.setttings\.features\.group_call_max_users\)'
)
RE_ZINST_BUBBLE_V2 = re.compile(
    r"case ([A-Za-z_$][\w$]*)\.MSG_ZINSTANT_OLD:case \1\.MSG_ZINSTANT:"
    r"(?!case \1\.MSG_ZINSTANT_V2:)"
    r"([A-Za-z_$][\w$]*=[A-Za-z_$][\w$]*\.a\.createElement\([A-Za-z_$][\w$]*\.b,\{key:)"
)
RE_OJT1_HEAD = re.compile(
    r'oJT1:function\(e,t,n\)\{"use strict";[^;]+;'
    r'var [A-Za-z_$][\w$]*=n\("iuhU"\),[A-Za-z_$][\w$]*=n\("jDHv"\),'
    r'([A-Za-z_$][\w$]*)=n\("RoG4"\),([A-Za-z_$][\w$]*)=n\("q1tI"\),'
    r'([A-Za-z_$][\w$]*)=n\.n\(\2\),[A-Za-z_$][\w$]*=n\("ZTgy"\),'
    r'[A-Za-z_$][\w$]*=n\("lteq"\),([A-Za-z_$][\w$]*)=n\("c51z"\)'
)
RE_OJT1_ERR = re.compile(
    r"\(([A-Za-z_$][\w$]*)\.loadState===([A-Za-z_$][\w$]*)\.ZINSTANT_DOM_LOAD_FAILED\|\|"
    r"\1\.loadState===\2\.ZINSTANT_DATA_LOAD_FAILED\)&&"
    r"([A-Za-z_$][\w$]*\.a\.createElement\(\"div\",\{className:\"flx flx-al-c flx-center flx-col zinstant-error\","
    r"onContextMenu:[A-Za-z_$][\w$]*\},[A-Za-z_$][\w$]*\.a\.createElement\([A-Za-z_$][\w$]*\.a,"
    r"\{className:\"Warning_Circle_24_Line margin-bottom-8\"\}\),"
    r"[A-Za-z_$][\w$]*\.a\.createElement\([A-Za-z_$][\w$]*\.a,\{textKey:\"STR_RENDER_ZINST_FAIL\",className:\"zinstant-error__text\"\}\),"
    r"[A-Za-z_$][\w$]*\.a\.createElement\([A-Za-z_$][\w$]*\.a,\{textKey:\"STR_RETRY\",className:\"zinstant-error__text clickable\","
    r"onClick:\(\)=>[A-Za-z_$][\w$]*\(\)\}\)\))"
)
RE_MSGINFO_CALL_SWITCH = re.compile(
    r"case ([A-Za-z_$][\w$]*)\.act_call_voice:this\._callVoice\(e\.actionData\);break;"
    r"case \1\.act_call_video:this\._callVideo\(e\.actionData\);break;"
)
RE_ZINST_QUOTE_V2 = re.compile(
    r"case ([A-Za-z_$][\w$]*)\.MSG_ZINSTANT_OLD:case \1\.MSG_ZINSTANT:"
    r"(?!case \1\.MSG_ZINSTANT_V2:)return ([A-Za-z_$][\w$]*);"
)
RE_GEN_CALL_MSG_ANY = re.compile(
    r"generateCallMsgTemplate\(e,t\)\{"
    r"let n=([A-Za-z_$][\w$]*)\.default\.getNextLocalId\(e\.lastSmsLocalId\),"
    r"a=e\.userId,([A-Za-z_$][\w$]*)=e\.displayName,([A-Za-z_$][\w$]*)=t\.caller,"
    r"([A-Za-z_$][\w$]*)=t\.duration\?Math\.floor\(t\.duration/1e3\):0;"
    r"(?:const _zg=[^;]+;)?"
    r"return\{actionId:null,cliMsgId:([A-Za-z_$][\w$]*)\.a\.next\(\),"
    r"content:\{.+?\},"
    r"dName:[^,]+,idTo:a,isGroup:[^,]+,mentions:null,msgId:n,msgKey:a,msgType:\"chat\.recommended\","
    r"notify:\"1\",quote:null,status:([A-Za-z_$][\w$]*)\.MSG_READ,"
    r"ts:\"\"\+([A-Za-z_$][\w$]*)\.default\.getTimeNow\(\),uidFrom:[^,]+,isCallMessage:!0\}\}"
)
RE_BUBBLE_ANY = re.compile(
    r'case"bubble":\{if\(A\.default\.call\.sync_call_message\.ui(?:&&!\(n&&n\.group\))?\)return;'
    r'(?:const _zgp=[^;]+;|const e=\{[^}]+\};)'
)


def patch_pc_bundle(path: Path) -> int:
    orig = path.read_text(encoding="utf-8", errors="surrogateescape")
    text = orig
    hits = 0

    # 1. isSupport & isSupportVideoCall (cả biến `se` và `ie`)
    text, n = RE_IS_SUPPORT.subn("isSupport(){return !0}isSupportVideoCall(){return !0}", text)
    hits += n

    # 2. canUseIpcCall -> !0 (ngăn gắn _optional=!0 làm tịt spawn zcall-engine)
    old_ipc = "canUseIpcCall(){return A.default.enable_ipc_call&&ne}"
    if old_ipc in text:
        text = text.replace(old_ipc, "canUseIpcCall(){return !0}")
        hits += 1

    # 3. using_queue: 1 -> 0
    old_uq = "using_queue:1,debug:{enable:1,retry:{send_log_end_call:1}}"
    if old_uq in text:
        text = text.replace(old_uq, "using_queue:0,debug:{enable:1,retry:{send_log_end_call:1}}")
        hits += 1

    # 4. Tuần tự hoá FIFO nghiêm ngặt cho CallController.handleSendSignal:
    #    Vì s.default.*Call(...) khởi chạy HTTP fetch ngay trong switch(t), cần bọc toàn bộ
    #    handleSendSignal vào chuỗi Promise _zaSigChain (timeout an toàn 4s) để 405 (cancel) /
    #    409 (endcall) không bao giờ vượt mặt 401 / 416 / 402 đang bay trên mạng.
    if "_zaSendSignalNow(" not in text:
        text, n_head = RE_SIG_HEAD.subn(
            r"AdvancedOptionsFromNative(n)}}handleSendSignal(e,t,n){"
            r"this._zaSigChain=(this._zaSigChain||Promise.resolve()).catch((()=>{})).then((()=>this._zaSendSignalNow(e,t,n)))"
            r"}_zaSendSignalNow(e,t,n){let a,\1;"
            r'switch(this.logInfo("call-send-signal",JSON.stringify(n)),t){',
            text,
            count=1,
        )
        text, n_tail = RE_SIG_TAIL.subn(
            r"if(!a)return Promise.resolve();"
            r"return new Promise((_zaDone=>{"
            r"const _zaTimer=setTimeout(_zaDone,4e3),_zaFin=()=>{clearTimeout(_zaTimer),_zaDone()};"
            r"a.then((_zaRes=>{_zaFin(),this.handleRecvSignal(t,_zaRes)}))"
            r".catch((_zaErr=>{_zaFin(),this.handleSendSignalError(t,_zaErr,"
            r"{onSuccess:this.handleRecvSignal.bind(this,t),callId:n&&n.callId,callback:\1})}))"
            r"}))}handleSendSignalError(",
            text,
            count=1,
        )
        if n_head != n_tail:
            fail(f"{path.name}: lệch điểm vá _zaSendSignalNow (head={n_head}, tail={n_tail})")
        hits += n_head + n_tail

    # 4b. Chuyển tiếp LỖI server của signalling nhóm (12433..12447, 12043/12044, 12097/12098) về engine
    #     dưới dạng recvSignal{data:{__error:{error_code,code,error_message,message}}} — mặc định Zalo chỉ log
    #     rồi nuốt lỗi nên engine không thể hiệu chỉnh payload join/answer. Chỉ chuyển 4 trường lỗi, không
    #     chuyển body/headers (không lộ cookie/session).
    if "_zaFwdGroupErr" not in text and "_zaSendSignalNow(" in text:
        catch_old = ".catch((_zaErr=>{_zaFin(),this.handleSendSignalError(t,_zaErr,"
        catch_new = ".catch((_zaErr=>{_zaFin(),this._zaFwdGroupErr(t,_zaErr),this.handleSendSignalError(t,_zaErr,"
        meth_old = "handleSendSignalError(e,t,n={}){"
        meth_new = (
            "_zaFwdGroupErr(e,t){try{if(!(e>=12433&&e<=12447||12043===e||12044===e||12097===e||12098===e))return;"
            'const n=t&&"object"==typeof t?t:{};'
            'this._sendToNative({type:"recvSignal",command:e,data:{__error:{error_code:n.error_code,code:n.code,'
            'error_message:"string"==typeof n.error_message?n.error_message:void 0,'
            'message:"string"==typeof n.message?n.message:void 0}}})}catch(o){}}'
            + meth_old
        )
        if catch_old in text and meth_old in text:
            text = text.replace(catch_old, catch_new, 1)
            text = text.replace(meth_old, meth_new, 1)
            hits += 2

    # 5. Khởi tạo trạng thái running cho queue & dequeue ngay khi tạo
    text, n = RE_QUEUE_STATE.subn(
        r'\1="running",\2="pause",\3=3e4;function \4(e={}){const{limit:t=1/0,maxTimeout:n=\3}=e,a=[];let \5=\1;',
        text,
    )
    hits += n
    text, n = RE_REQ_DEQUEUE.subn(r"\1,this.requestQueue.dequeue(),\2", text)
    hits += n

    # 6. Bật mặc định enableCall & enableVideoCall
    old_ec = "enableCall:!1,enableTag:!0,enableVideoCall:!1"
    if old_ec in text:
        text = text.replace(old_ec, "enableCall:!0,enableTag:!0,enableVideoCall:!0")
        hits += 1

    # 7. Bỏ check Darwin kernel < 17 trên Linux
    old_rel = 'if(Number(e.split(".")[0])<17)return ae=()=>!1,!1'
    if old_rel in text:
        text = text.replace(old_rel, 'if("linux"!==$znode.os.platform()&&Number(e.split(".")[0])<17)return ae=()=>!1,!1')
        hits += 1

    # 8a. Bật cờ Group Call mặc định & giữ không bị server features ghi đè về 0 khi login
    old_gf_def = "enable_group_call_for_user:0,enable_group_call_entry_for_group:0,group_call_max_users:5"
    if old_gf_def in text:
        text = text.replace(
            old_gf_def,
            "enable_group_call_for_user:1,enable_group_call_entry_for_group:100,group_call_max_users:8",
        )
        hits += 1
    text, n = RE_GRP_FEATURES.subn(
        r"(\1.default.enable_group_call_for_user=1),"
        r"(\1.default.enable_group_call_entry_for_group=t.setttings.features.enable_group_call_entry_for_group||100),"
        r"(\1.default.group_call_max_users=t.setttings.features.group_call_max_users||8)",
        text,
    )
    hits += n

    # 8b. Mở nhánh MSG_ZINSTANT_V2 (`chat.webcontent.v2`) cho cả Bubble renderer (`Ba`) và Quote/Pin preview
    text, n = RE_ZINST_BUBBLE_V2.subn(
        r"case \1.MSG_ZINSTANT_OLD:case \1.MSG_ZINSTANT:case \1.MSG_ZINSTANT_V2:\2",
        text,
        count=1,
    )
    hits += n
    text, n = RE_ZINST_QUOTE_V2.subn(
        r"case \1.MSG_ZINSTANT_OLD:case \1.MSG_ZINSTANT:case \1.MSG_ZINSTANT_V2:return \2;",
        text,
        count=1,
    )
    hits += n

    # 8c. Hiển thị trực tiếp thẻ customMsg + nút CTA ("Tham gia") trong oJT1 cho tin nhắn ZInstant/Group Call
    #     thay vì chờ <z-instant> lỗi hoặc treo ở trạng thái IDLE skeleton.
    idx_ojt1 = text.find("oJT1:function")
    if idx_ojt1 != -1:
        sub = text[idx_ojt1 : idx_ojt1 + 7500]
        m_head = RE_OJT1_HEAD.search(sub)
        if not m_head:
            fail(f"{path.name}: không khớp RE_OJT1_HEAD trong oJT1")
        rog4_v, _, react_v, _ = m_head.groups()
        fallback_expr = (
            f"(()=>{{try{{const _md={rog4_v}.h.create(new {rog4_v}.h.Adapters.MessageEntity(e)).getZInstantMetadata(),"
            "_cm=_md&&_md.customMsg||e&&e.message&&e.message.customMsg;if(!_cm||!_cm.msg)return null;"
            'const _lg="undefined"!=typeof document&&"en"===document.documentElement.lang?"en":"vi";'
            'let _tx="string"==typeof _cm.msg?_cm.msg:_cm.msg[_lg]||_cm.msg.vi||_cm.msg.en||"";'
            "const _hl=Array.isArray(_cm.highLightsV2)?_cm.highLightsV2:Array.isArray(_cm.highLights)?_cm.highLights:[];"
            'for(let _k=0;_k<_hl.length;_k++){const _it=_hl[_k],_lb="string"==typeof _it?_it:_it&&(_it.dpn||_it.name||_it.text)||"";'
            '_tx=_tx.split("%"+(_k+1)+"$s").join(_lb).split("$"+(_k+1)+"$s").join(_lb)}'
            "if(!_tx)return null;const _acts=Array.isArray(_cm.action)?_cm.action:[];"
            f'return {react_v}.a.createElement("div",{{className:"flx flx-al-c flx-sp-btw _zaZinstCard",onContextMenu:t,'
            'style:{padding:"10px 14px",borderRadius:"8px",background:"rgba(0,104,255,0.08)",gap:"12px",minWidth:"210px"}},'
            f'{react_v}.a.createElement("span",{{style:{{fontSize:"13px",fontWeight:500,lineHeight:"18px"}}}},_tx),'
            "_acts.map(((_ac,_ai)=>{if(!_ac)return null;"
            'const _alb=_ac.actionLabelv2&&"object"==typeof _ac.actionLabelv2?_ac.actionLabelv2[_lg]||_ac.actionLabelv2.vi||_ac.actionLabel:_ac.actionLabel;'
            f'return _alb?{react_v}.a.createElement("button",{{key:_ai,type:"button",className:"clickable",'
            'style:{border:"none",borderRadius:"6px",padding:"5px 12px",background:"#0068ff",color:"#fff",fontSize:"12px",fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"},'
            'onClick:_ev=>{_ev.stopPropagation(),_ev.preventDefault(),window.dispatchEvent(new CustomEvent("zalux:call-action",'
            "{detail:{convId:e&&(e.toUid||e.idTo),msgId:e&&e.msgId,actionType:_ac.actionType,actionData:_ac.actionData}}))}},_alb):null})))"
            "}catch(_ze){return null}})()"
        )
        if "_zaDirectCard" not in sub:
            re_frag = re.compile(
                rf"return {re.escape(react_v)}\.a\.useEffect\(\(\(\)=>\{{[A-Za-z_$][\w$]*\(\)\}}\),\[[A-Za-z_$][\w$]*\]\),"
                rf"{re.escape(react_v)}\.a\.useEffect\(\(\(\)=>\(\)=>{{[^}}]+\}}\),\[\]\),"
                rf"(?:const _zaDirectCard=[^;]+;if\(_zaDirectCard\)return _zaDirectCard;return )?"
                rf"{re.escape(react_v)}\.a\.createElement\({re.escape(react_v)}\.a\.Fragment,null,"
            )
            m_frag = re_frag.search(sub)
            if not m_frag:
                fail(f"{path.name}: không khớp Fragment đầu ra trong oJT1")
            eff_prefix = m_frag.group(0)[: -len(f"{react_v}.a.createElement({react_v}.a.Fragment,null,")]
            new_frag = (
                eff_prefix
                + f"(()=>{{"
                + f"const _zaDirectCard={fallback_expr};"
                + f"if(_zaDirectCard)return _zaDirectCard;"
                + f"return {react_v}.a.createElement({react_v}.a.Fragment,null,"
            )
            sub = sub[: m_frag.start()] + new_frag + sub[m_frag.end() :]
            old_close = ",onContextMenu:t}))};let "
            new_close = ",onContextMenu:t}))})()};let "
            if old_close not in sub:
                fail(f"{path.name}: không khớp đóng hàm C trong oJT1")
            sub = sub.replace(old_close, new_close, 1)
            if "_zaZinstCard" not in orig[idx_ojt1 : idx_ojt1 + 7500]:
                sub, n_err = RE_OJT1_ERR.subn(
                    lambda m: (
                        f"({m.group(1)}.loadState==={m.group(2)}.ZINSTANT_DOM_LOAD_FAILED||"
                        f"{m.group(1)}.loadState==={m.group(2)}.ZINSTANT_DATA_LOAD_FAILED)&&"
                        f"({fallback_expr}||{m.group(3)})"
                    ),
                    sub,
                    count=1,
                )
            text = text[:idx_ojt1] + sub + text[idx_ojt1 + 7500 :]
            hits += 1

    # 8d. Nối MessageInfo._callVoice / _callVideo bắn sự kiện zalux:call-action
    old_mi_methods = "_openStickerStore(e){}_callVoice(e){}_callVideo(e){}"
    if old_mi_methods in text:
        text = text.replace(
            old_mi_methods,
            '_openStickerStore(e){}_zaCallAct(e,t,n){try{"undefined"!=typeof window&&window.dispatchEvent('
            'new CustomEvent("zalux:call-action",{detail:{convId:t&&t.toUid,isGroup:!!(t&&t.isGroup),video:n,'
            'actionType:n?"action.call.video":"action.call.voice",actionData:e}}))}catch(a){}}'
            "_callVoice(e,t){this._zaCallAct(e,t,!1)}_callVideo(e,t){this._zaCallAct(e,t,!0)}",
            1,
        )
        hits += 1
    text, n = RE_MSGINFO_CALL_SWITCH.subn(
        r"case \1.act_call_voice:this._callVoice(e.actionData,t);break;"
        r"case \1.act_call_video:this._callVideo(e.actionData,t);break;",
        text,
        count=1,
    )
    hits += n

    # 8e. CallController & ChatBoxController:
    #     - Lưu fallback window.__zaluxGenMessageServer tại MainView._genMessageServer để mọi
    #       ChatBoxController đều bơm được tin nhắn cuộc gọi nhóm kể cả khi chưa mở khung chat.
    #     - Mở nhánh case "bubble": khi n && n.group (truyền hostUid64, hostName, video, group).
    #     - Sửa generateCallMsgTemplate tạo đúng uidFrom 64-bit (không dùng hostCall 32-bit hoặc groupId)
    #       và dName của người gọi để thẻ cuộc gọi nhóm hiển thị chuẩn trong khung chat nhóm.
    old_bind_srv = "this._genMessageServer=this._genMessageServer.bind(this)"
    new_bind_srv = (
        "this._genMessageServer=this._genMessageServer.bind(this),"
        '("undefined"!=typeof window&&(window.__zaluxGenMessageServer=this._genMessageServer))'
    )
    if new_bind_srv not in text and old_bind_srv in text:
        text = text.replace(old_bind_srv, new_bind_srv, 1)
        hits += 1

    old_gen_srv = "_genMessageServer(e){this.fetcher._processChatMessages(e,this._processData,this._isSeenFunc,!0)}"
    new_gen_srv = (
        "_genMessageServer(e){try{\"undefined\"!=typeof window&&(window.__zaluxGenMessageServer=this._genMessageServer.bind(this))}catch(_z){}"
        "this.fetcher._processChatMessages(e,this._processData,this._isSeenFunc,!0)}"
    )
    if old_gen_srv in text:
        text = text.replace(old_gen_srv, new_gen_srv, 1)
        hits += 1

    old_gen_call = (
        "let n={statusMap:{},messages:[V.d.generateCallMsgTemplate(e,t)]};"
        'this.genMessageServer?this.genMessageServer(n):this.Logger.zsymb(21,"b9r8J1",["genMessageServer not exists","yRQvRC"])'
    )
    old_gen_call_v2 = (
        "let n={statusMap:{},messages:[V.d.generateCallMsgTemplate(e,t)]};"
        'const _zgms=this.genMessageServer||("undefined"!=typeof window&&window.__zaluxGenMessageServer);'
        '_zgms?_zgms(n):this.Logger.zsymb(21,"b9r8J1",["genMessageServer not exists","yRQvRC"])'
    )
    new_gen_call = (
        "let n={statusMap:{},messages:[V.d.generateCallMsgTemplate(e,t)]};"
        'const _zgms=this.genMessageServer||("undefined"!=typeof window&&window.__zaluxGenMessageServer)'
        '||(a&&a("k+R1")&&a("k+R1").default&&a("k+R1").default.wins&&a("k+R1").default.wins["1"]&&a("k+R1").default.wins["1"].controller&&a("k+R1").default.wins["1"].controller.genMessageServer);'
        '_zgms?_zgms(n):this.Logger.zsymb(21,"b9r8J1",["genMessageServer not exists","yRQvRC"])'
    )
    if new_gen_call not in text:
        for cand in (
            old_gen_call_v2,
            old_gen_call,
            'let n={statusMap:{},messages:[V.d.generateCallMsgTemplate(e,t)]};const _zgms=this.genMessageServer||("undefined"!=typeof window&&window.__zaluxGenMessageServer)||(q&&q.default&&q.default.wins&&q.default.wins[Zt.c]&&q.default.wins[Zt.c].controller&&q.default.wins[Zt.c].controller.genMessageServer);_zgms?_zgms(n):this.Logger.zsymb(21,"b9r8J1",["genMessageServer not exists","yRQvRC"])',
        ):
            if cand in text:
                text = text.replace(cand, new_gen_call, 1)
                hits += 1
                break

    idx_gcm = text.find("generateCallMsgTemplate(e,t){")
    if idx_gcm != -1:
        sub_gcm = text[idx_gcm : idx_gcm + 1600]
        if "_hu64=" not in sub_gcm:
            m_gcm = RE_GEN_CALL_MSG_ANY.search(sub_gcm)
            if m_gcm:
                id_m, dn_v, cal_v, dur_v, cli_v, const_mod, ts_m = m_gcm.groups()
                new_gcm = (
                    f"generateCallMsgTemplate(e,t){{"
                    f"let n={id_m}.default.getNextLocalId(e.lastSmsLocalId),"
                    f"a=e.userId,{dn_v}=e.displayName,{cal_v}=t.caller,"
                    f"{dur_v}=t.duration?Math.floor(t.duration/1e3):0;"
                    f'const _zg=!!(t&&t.group),_hu64=_zg&&t.hostUid64?""+t.hostUid64:"",'
                    f'_hdn=_zg&&(t.hostName||(_hu64&&"undefined"!=typeof T&&T.default&&T.default.getDName&&T.default.getDName(_hu64)))||{dn_v}||"Thành viên",'
                    f'_zt=_zg?({dur_v}>0?"Cuộc gọi nhóm":{cal_v}?"Cuộc gọi nhóm đi":"Cuộc gọi nhóm nhỡ"):({cal_v}?"Cuộc gọi đi":"Cuộc gọi đến"),'
                    f'_zd=_zg?"Cuộc gọi nhóm kết thúc":_zt;'
                    f"return{{actionId:null,cliMsgId:{cli_v}.a.next(),"
                    f'content:{{action:{dur_v}>0||!_zg?({cal_v}?"recommened.calling":"recommened.receivecall"):"recommened.misscall",duration:{dur_v},childnumber:0,'
                    f'description:_zd,href:"",params:JSON.stringify({{isEnableCallback:1,calltype:t&&t.video?1:0}}),'
                    f'thumbs:"",title:_zt,type:""}},'
                    f'dName:_hdn,idTo:a,isGroup:_zg,mentions:null,msgId:n,msgKey:a,msgType:"chat.recommended",'
                    f'notify:"1",quote:null,status:{const_mod}.MSG_READ,'
                    f'ts:""+{ts_m}.default.getTimeNow(),uidFrom:{cal_v}||!_hu64?"0":_hu64,isCallMessage:!0}}}}'
                )
                sub_gcm_new = sub_gcm[: m_gcm.start()] + new_gcm + sub_gcm[m_gcm.end() :]
                text = text[:idx_gcm] + sub_gcm_new + text[idx_gcm + 1600 :]
                hits += 1

    new_bub_stmt = (
        'case"bubble":{if(A.default.call.sync_call_message.ui&&!(n&&n.group))return;'
        'const _zgp=n&&n.group&&n.partnerId&&!(""+n.partnerId).startsWith("g")?"g"+n.partnerId:n.partnerId,'
        "e={caller:n.role,duration:1e3*n.duration,userId:_zgp,group:!!(n&&n.group),groupName:n&&n.groupName,"
        "video:!!(n&&n.video),hostId:n&&n.hostId,hostUid64:n&&n.hostUid64,hostName:n&&n.hostName,callId:n&&n.callId};"
    )
    if new_bub_stmt not in text:
        text, n_bub = RE_BUBBLE_ANY.subn(new_bub_stmt, text, count=1)
        hits += n_bub

    old_bind_cb = "bindCallbackGenerateReceiveCallMessage(e){this.callbackGenerateReceiveCallMessage=e}"
    if old_bind_cb in text:
        new_bind_cb = (
            "bindCallbackGenerateReceiveCallMessage(e){this.callbackGenerateReceiveCallMessage=e,"
            '"undefined"==typeof window||this._zaCallActBound||(this._zaCallActBound=!0,'
            'window.addEventListener("zalux:call-action",(_ev=>{try{this._sendToNative('
            '{type:"request",command:"joinGroupCall",data:_ev&&_ev.detail||{}})}catch(_ze){}})))}'
        )
        text = text.replace(old_bind_cb, new_bind_cb, 1)
        hits += 1

    # 8f. Mở nhánh recommened.groupcall (từ Mobile Sync ZDB4) vào _normalizeRecommendMsgSubType,
    #     Call Bubble renderer (p.a / g.a), context menu và parser r6Qt.
    old_rc_1 = 'case"recommened.misscall":case"recommened.calling":case"recommened.receivecall":case"recommened.calltime":'
    new_rc_1 = 'case"recommened.misscall":case"recommened.calling":case"recommened.receivecall":case"recommened.calltime":case"recommened.groupcall":'
    if new_rc_1 not in text and old_rc_1 in text:
        text = text.replace(old_rc_1, new_rc_1)
        hits += 1

    old_rc_2 = 'case"recommened.misscall":case"recommened.calling":case"recommened.calltime":case"recommened.receivecall":'
    new_rc_2 = 'case"recommened.misscall":case"recommened.calling":case"recommened.calltime":case"recommened.receivecall":case"recommened.groupcall":'
    if new_rc_2 not in text and old_rc_2 in text:
        text = text.replace(old_rc_2, new_rc_2)
        hits += 1

    old_rc_set = 'new Set(["recommened.misscall","recommened.calling","recommened.receivecall"])'
    new_rc_set = 'new Set(["recommened.misscall","recommened.calling","recommened.receivecall","recommened.groupcall"])'
    if new_rc_set not in text and old_rc_set in text:
        text = text.replace(old_rc_set, new_rc_set)
        hits += 1

    for old_nva5, new_nva5 in (
        (
            "case a.MessageContentAction.MissCall:case a.MessageContentAction.Calling:case a.MessageContentAction.ReceiveCall:case a.MessageContentAction.CallTime:",
            'case a.MessageContentAction.MissCall:case a.MessageContentAction.Calling:case a.MessageContentAction.ReceiveCall:case a.MessageContentAction.CallTime:case"recommened.groupcall":',
        ),
        (
            "case s.MessageContentAction.MissCall:case s.MessageContentAction.Calling:case s.MessageContentAction.ReceiveCall:case s.MessageContentAction.CallTime:",
            'case s.MessageContentAction.MissCall:case s.MessageContentAction.Calling:case s.MessageContentAction.ReceiveCall:case s.MessageContentAction.CallTime:case"recommened.groupcall":',
        ),
    ):
        if new_nva5 not in text and old_nva5 in text:
            text = text.replace(old_nva5, new_nva5)
            hits += 1

    for old_rc_arr, new_rc_arr in (
        (
            '["recommened.link","recommened.user","recommened.stickerset","recommened.vip","recommened.misscall","recommened.calling","recommened.calltime","recommened.receivecall"]',
            '["recommened.link","recommened.user","recommened.stickerset","recommened.vip","recommened.misscall","recommened.calling","recommened.calltime","recommened.receivecall","recommened.groupcall"]',
        ),
        (
            '["recommened.user","recommened.vip","recommened.misscall","recommened.calling","recommened.calltime","recommened.receivecall","recommened.stickerset"]',
            '["recommened.user","recommened.vip","recommened.misscall","recommened.calling","recommened.calltime","recommened.receivecall","recommened.groupcall","recommened.stickerset"]',
        ),
        (
            '["recommened.link","recommened.stickerset","recommened.misscall","recommened.calling","recommened.receivecall","recommened.calltime"]',
            '["recommened.link","recommened.stickerset","recommened.misscall","recommened.calling","recommened.receivecall","recommened.calltime","recommened.groupcall"]',
        ),
        (
            'new Set(["recommened.misscall","recommened.calling","recommened.calltime","recommened.receivecall"])',
            'new Set(["recommened.misscall","recommened.calling","recommened.calltime","recommened.receivecall","recommened.groupcall"])',
        ),
        (
            '"recommened.misscall"===t.message.action||"recommened.calling"===t.message.action||"recommened.receivecall"===t.message.action||"recommened.calltime"===t.message.action',
            '"recommened.misscall"===t.message.action||"recommened.calling"===t.message.action||"recommened.receivecall"===t.message.action||"recommened.calltime"===t.message.action||"recommened.groupcall"===t.message.action',
        ),
        (
            '"recommened.calling"===t.message.action||"recommened.calltime"===t.message.action||"recommened.receivecall"===t.message.action||"recommened.misscall"===t.message.action',
            '"recommened.calling"===t.message.action||"recommened.calltime"===t.message.action||"recommened.receivecall"===t.message.action||"recommened.misscall"===t.message.action||"recommened.groupcall"===t.message.action',
        ),
        (
            '"recommened.misscall"==e.message.action||"recommened.receivecall"==e.message.action||"recommened.calltime"==e.message.action||"recommened.calling"==e.message.action',
            '"recommened.misscall"==e.message.action||"recommened.receivecall"==e.message.action||"recommened.calltime"==e.message.action||"recommened.calling"==e.message.action||"recommened.groupcall"==e.message.action',
        ),
    ):
        if new_rc_arr not in text and old_rc_arr in text:
            text = text.replace(old_rc_arr, new_rc_arr)
            hits += 1

    re_r6qt = re.compile(
        r"const l=function\(e\)\{return 1===e\?([A-Za-z_$][\w$]*)\.d\.VIDEO:\1\.d\.AUDIO\}\(a\.calltype\);"
        r"return\{duration:null!==\(n=a\.duration\)&&void 0!==n\?n:t\.duration,"
        r"enableCallback:a\.isEnableCallback,reason:([A-Za-z_$][\w$]*),status:([A-Za-z_$][\w$]*),subject:([A-Za-z_$][\w$]*),type:l\}"
    )
    text, n_r6qt = re_r6qt.subn(
        r"const l=function(e){return 1===e?\1.d.VIDEO:\1.d.AUDIO}(null!=a.calltype?a.calltype:a.type);"
        r'return{duration:null!==(n=a.duration)&&void 0!==n?n:t.duration||0,'
        r'enableCallback:null!=a.isEnableCallback?a.isEnableCallback:"recommened.groupcall"===t.action?1:0,'
        r"reason:\2,status:\3,subject:\4,type:l}",
        text,
    )
    hits += n_r6qt

    if text != orig:
        atomic_write(path, text)
        print(f"    + {path.name}: áp dụng {hits} điểm vá Call UI & Signaling")
    else:
        print(f"    = {path.name}: đã được patch")
    return hits


def patch_preload_sqlite() -> None:
    if not PRELOAD_SQLITE.is_file():
        return
    orig = PRELOAD_SQLITE.read_text(encoding="utf-8", errors="surrogateescape")
    text = orig
    hits = 0

    for old_grp in (
        "enable_group_call_for_user:0,enable_group_call_entry_for_group:0,group_call_max_users:5",
        "enable_group_call_for_user:1,enable_group_call_entry_for_group:1,group_call_max_users:5",
        "enable_group_call_for_user:0,enable_group_call_entry_for_group:0",
        "enable_group_call_for_user:1,enable_group_call_entry_for_group:1,",
    ):
        if old_grp in text:
            repl_grp = (
                "enable_group_call_for_user:1,enable_group_call_entry_for_group:100,group_call_max_users:8"
                if "group_call_max_users" in old_grp
                else "enable_group_call_for_user:1,enable_group_call_entry_for_group:100,"
            )
            text = text.replace(old_grp, repl_grp, 1)
            hits += 1
            break

    old_chat_call = "at.enableCall=t}catch(ht){}try{let t=1==e.settings.chat.enable_video_call;at.enableVideoCall=t}"
    new_chat_call = "at.enableCall=!0}catch(ht){}try{let t=1==e.settings.chat.enable_video_call;at.enableVideoCall=!0}"
    if old_chat_call in text:
        text = text.replace(old_chat_call, new_chat_call, 1)
        hits += 1

    if text != orig:
        atomic_write(PRELOAD_SQLITE, text)
        print(f"    + {PRELOAD_SQLITE.name}: mở cờ Call/Video & Group Call ({hits} điểm)")
    else:
        print(f"    = {PRELOAD_SQLITE.name}: cờ Call đã được patch")


def patch_shared_worker() -> None:
    matches = sorted(glob.glob(str(PC_DIST / "shared-worker.*.js")))
    for m in matches:
        p = Path(m)
        orig = p.read_text(encoding="utf-8", errors="surrogateescape")
        text = orig
        hits = 0

        old_ie = 'const Ie=\'type != "chat.webcontent" AND type != "chat.livelocation" AND type != "chat.video.live.msg"\''
        new_ie = 'const Ie=\'type != "chat.livelocation" AND type != "chat.video.live.msg"\''
        if old_ie in text:
            text = text.replace(old_ie, new_ie)
            hits += 1

        old_skip_1 = 'if(!a.attach||!a.attach.params||-1==a.attach.params.indexOf("pcItem"))return void this.logger.zsymb(0,"kDw7eg","Skip invalid zinstant",null==e?void 0:e.globalMsgId);'
        new_skip_1 = 'if(!a.attach||!a.attach.params)return void this.logger.zsymb(0,"kDw7eg","Skip invalid zinstant",null==e?void 0:e.globalMsgId);'
        if old_skip_1 in text:
            text = text.replace(old_skip_1, new_skip_1)
            hits += 1

        old_skip_2 = 'if(!a.attach||!a.attach.params||-1==a.attach.params.indexOf("pcItem"))return void this.logger.zsymb(0,"RsVsZn","Skip invalid zinstant",null==e?void 0:e.globalMsgId);'
        new_skip_2 = 'if(!a.attach||!a.attach.params)return void this.logger.zsymb(0,"RsVsZn","Skip invalid zinstant",null==e?void 0:e.globalMsgId);'
        if old_skip_2 in text:
            text = text.replace(old_skip_2, new_skip_2)
            hits += 1

        for old_qe in (
            "const Qe=[20,21,25,26,29,32,34,35,45,51,52].map",
            "const Qe=[20,25,26,29,32,34,35,45,51,52].map",
        ):
            new_qe = "const Qe=[25,26,29,32,34,35,45,51,52].map"
            if old_qe in text:
                text = text.replace(old_qe, new_qe)
                hits += 1

        old_je = '20:"webchat",22:"share.file"'
        new_je = '20:"webchat",21:"chat.ecard",22:"share.file"'
        if old_je in text:
            text = text.replace(old_je, new_je)
            hits += 1

        old_sw_rc = 'case"recommened.misscall":case"recommened.calling":case"recommened.receivecall":case"recommened.calltime":'
        new_sw_rc = 'case"recommened.misscall":case"recommened.calling":case"recommened.receivecall":case"recommened.calltime":case"recommened.groupcall":'
        if new_sw_rc not in text and old_sw_rc in text:
            text = text.replace(old_sw_rc, new_sw_rc)
            hits += 1

        old_sw_fn = 'fromId:e.SenderId.toString(),fromName:"",attach:"{}",attachData:r,'
        new_sw_fn = 'fromId:e.SenderId.toString(),fromName:r&&r.dName||"",attach:"{}",attachData:r,'
        if new_sw_fn not in text and old_sw_fn in text:
            text = text.replace(old_sw_fn, new_sw_fn)
            hits += 1

        old_sw_txt = 'case ee.MSG_TEXT:a&&a.attach&&a.attach.action&&"rtf"==a.attach.action&&(a.attach.title||(a.attach.title=e.msg),n=a.attach);break;'
        new_sw_txt = (
            'case ee.MSG_TEXT:if(a&&a.attach&&a.attach.action&&("rtf"==a.attach.action||"msginfo.actionlist"==a.attach.action)){'
            'if("msginfo.actionlist"==a.attach.action&&a.attach.params)try{const _p=JSON.parse(a.attach.params);'
            'Array.isArray(_p.highLightsV2)&&(_p.highLightsV2.forEach((_h=>{_h&&_h.uid&&(_h.uid=this.idStore.get(_h.uid)||_h.uid)})),a.attach.params=JSON.stringify(_p))}catch(_e){}'
            'a.attach.title||(a.attach.title=e.msg),n=a.attach}break;'
        )
        if new_sw_txt not in text and old_sw_txt in text:
            text = text.replace(old_sw_txt, new_sw_txt)
            hits += 1

        old_sw_ver = '"recommened.user"!==h&&"recommened.vip"!==h||null===(n=u.attach)||void 0===n||!n.params||d(u.attach.params),'
        new_sw_ver = (
            '"recommened.user"!==h&&"recommened.vip"!==h||null===(n=u.attach)||void 0===n||!n.params||d(u.attach.params),'
            '"msginfo.actionlist"===h&&u.attach&&u.attach.params&&(()=>{try{const _p=JSON.parse(u.attach.params);Array.isArray(_p.highLightsV2)&&_p.highLightsV2.forEach((_h=>{_h&&_h.uid&&d(_h.uid)}))}catch(_e){}})(),'
        )
        if new_sw_ver not in text and old_sw_ver in text:
            text = text.replace(old_sw_ver, new_sw_ver)
            hits += 1

        old_sw_cnt = 'case ee.MSG_CONTACT:n=a.attach||{},n.description=d(n.description),n.thumb=d(n.thumb);const t=n.action;"recommened.user"!==t&&"recommened.vip"!==t||(n.params=this.idStore.get(n.params));break;'
        new_sw_cnt = (
            'case ee.MSG_CONTACT:n=a.attach||{},n.description=d(n.description),n.thumb=d(n.thumb);const t=n.action;'
            '"recommened.user"!==t&&"recommened.vip"!==t||(n.params=this.idStore.get(n.params)),'
            '"recommened.groupcall"===t&&(()=>{try{const _p=n.params?JSON.parse(n.params):{};'
            'null==_p.calltype&&null!=_p.type&&(_p.calltype=_p.type),null==_p.isEnableCallback&&(_p.isEnableCallback=1),'
            'null==_p.duration&&(_p.duration=0),n.params=JSON.stringify(_p),n.duration=0,'
            '(!n.title||"sendGroupCallMessage"===n.title)&&(n.title=n.description||"Cuộc gọi nhóm")}catch(_e){}})();break;'
        )
        if new_sw_cnt not in text and old_sw_cnt in text:
            text = text.replace(old_sw_cnt, new_sw_cnt)
            hits += 1

        if text != orig:
            atomic_write(p, text)
            print(f"    + {p.name}: mở bộ lọc đồng bộ ZInstant/ECard ({hits} điểm)")
        else:
            print(f"    = {p.name}: bộ lọc đồng bộ ZInstant/ECard đã được patch")


def main() -> None:
    if not PC_DIST.is_dir():
        fail(f"không thấy {PC_DIST}")

    patterns = [
        "lazy/default-login-main-startup-shared-worker-znotification.*.js",
        "compact-app-pc.*.js",
        "search-worker.*.js",
        "sync-v2-sub-worker.*.js",
    ]
    patched_files = 0
    for pat in patterns:
        matches = sorted(glob.glob(str(PC_DIST / pat)))
        if not matches:
            fail(f"không tìm thấy bundle khớp {pat}")
        for m in matches:
            if patch_pc_bundle(Path(m)) > 0:
                patched_files += 1

    patch_shared_worker()
    patch_preload_sqlite()
    print(f"patch-call-ui: hoàn thành (cập nhật {patched_files} bundle pc-dist).")


if __name__ == "__main__":
    main()
