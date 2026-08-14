#!/usr/bin/env python3
"""Generate the ACMS assistant as a SINGLE n8n workflow.

Same multi-agent shape as before — a routing orchestrator in front of four
specialists — but collapsed into one workflow using `agentTool` nodes, which are
full agents (own model, own tools, own system prompt) that expose themselves to a
parent agent over an `ai_tool` connection. The earlier split across five
workflows existed only because `toolWorkflow` can call another workflow;
`agentTool` removes that constraint.

Tools that more than one specialist needs (the opportunity list) are a single
node wired to several agents rather than duplicated — node names must be unique
in a workflow, and the node name is what the model sees as the tool name.

Run:  python3 build_agent.py   (writes ./workflows/acmsOrch01.json)
"""

import json
import os

WF_ID = "acmsOrch01"
WF_NAME = "ACMS · AI Agent"
WEBHOOK_ID = "acms-orchestrator-01"

API = "http://100.122.6.64:4010/api"
AUTH = "=Bearer {{ $('ACMS Login').first().json.accessToken }}"

# "openai" — the production provider. Every model node the running system
#            actually uses is an OpenAI one; Groq and Ollama stay written into
#            the workflow but disabled, so re-enabling either is a one-constant
#            change and never a rebuild.
# "groq"   — seconds per answer; the shared free account is capped at 8000
#            tokens/minute *per model*, which is why the orchestrator and the
#            specialists deliberately run different models.
# "ollama" — local, unlimited, nothing leaves the server, minutes per answer.
#
# Anything other than "openai" is a deliberate, manual decision — there is no
# automatic failover onto the standby providers anywhere in this file.
PROVIDER = os.environ.get("ACMS_AGENT_PROVIDER", "openai")

# Structured specialist output is finished but ships as its own change, not
# folded into the provider switch: JSON-schema adherence differs between
# models, so it has to be validated against whichever provider is live, and
# bundling it here would leave a failed regression pointing at two causes.
# It has two halves that must move together — the parser node plus the
# orchestrator's relay rules — so both read this one constant.
# Default off = exactly what is deployed today. Turn on with ACMS_STRUCTURED=1.
STRUCTURED = os.environ.get("ACMS_STRUCTURED", "0") == "1"

# Documents are metered separately from chat. A whole tender is one very large
# call, so on Groq's 8000 tokens/minute the extracted text has to be cut down
# to fit; on OpenAI and Ollama it does not. Switching this constant moves both
# the enabled model node and the character budget together, so the two can
# never disagree.
DOC_PROVIDER = os.environ.get("ACMS_DOC_PROVIDER", "openai")
DOC_TEXT_LIMIT = 6000 if DOC_PROVIDER == "groq" else 30000

# Groq refusals are the one failure this system actually suffers from, and
# retrying an identical request cannot fix either kind: a 413 is deterministic,
# and a 429 is made worse by every extra attempt against the same per-minute
# budget. The agent nodes expose a second model input for exactly this case.
#
# But the fallback is split, because the same trade is right in one place and
# wrong in the other. Measured on this box: falling back to Ollama produced
# *correct* answers to the chat benchmark — and took 77s, 207s and 306s. The
# 306s one overran the chat client's own timeout, so the user waited five
# minutes and still got nothing. On the chat path a clear "try again in a
# minute" after three seconds is worth more than a right answer nobody waits
# for. A document is the opposite: it is a single huge call that Groq cannot
# take at all, minutes are already the norm there, and keeping a client's
# tender on the server is a feature rather than a cost.
FALLBACK_CHAT = (PROVIDER == "groq"
                 and os.environ.get("ACMS_AGENT_FALLBACK", "0") == "1")
FALLBACK_DOC = (PROVIDER == "groq"
                and os.environ.get("ACMS_DOC_FALLBACK", "1") == "1")

GROQ_ORCH_MODEL = "openai/gpt-oss-20b"
GROQ_SPEC_MODEL = "openai/gpt-oss-120b"
OLLAMA_MODEL = "qwen3-vl:30b-a3b-instruct-q4_K_M"

# The orchestrator only reads the question, picks a specialist and relays the
# answer — it is the cheapest, most frequent call in the system and does not
# need the larger model. The specialists and the document agent do the actual
# analysis over real tool payloads, so they get gpt-4o.
OPENAI_ORCH_MODEL = os.environ.get("ACMS_OPENAI_ORCH_MODEL", "gpt-4o-mini")
OPENAI_SPEC_MODEL = os.environ.get("ACMS_OPENAI_SPEC_MODEL", "gpt-4o")
OPENAI_DOC_MODEL = os.environ.get("ACMS_OPENAI_DOC_MODEL", "gpt-4o")
OPENAI_SPEC_LIGHT = os.environ.get("ACMS_OPENAI_SPEC_LIGHT", "gpt-4o-mini")

# 1.2, not the newer 1.3, and the reason is measured rather than cautious. The
# node version decides the *shape* of the response n8n hands to an output
# parser, not just the parameter layout. On 1.3 a specialist that answers
# without calling a tool returns content blocks; `outputParserStructured` calls
# .trim() on them and dies with "text.trim is not a function". autoFix cannot
# repair it — it asks the model to rewrite the JSON, and the JSON was never the
# problem — so every turn where the agent needs to ask for missing information
# became a generic error. Three such questions, three failures; on 1.2, three
# correct clarifying replies. The two versions are otherwise equivalent here:
# both take the model as a resourceLocator, which the task router depends on.
OPENAI_NODE_VERSION = float(os.environ.get("ACMS_OPENAI_NODE_VERSION", "1.2"))

# Task-based model routing, and only for the specialists — the one consumer
# where the work varies enough for the choice to mean anything. The
# orchestrator already runs the cheap model and only dispatches; a document is
# always a single huge call and always needs the large one.
#
# The selection criterion is the intent the deterministic router already
# computes in `Approval Gate`, so this adds no classification step and no model
# call: the decision exists before any model is reached.
#
# Only intents whose work is *retrieval of already-computed facts* are listed.
# Everything absent falls through to the large model, which is the safe
# direction to be wrong in. `pipeline_question` qualifies because the /q layer
# returns the rows and the `facts` block ready-made — the model formats and
# explains, it does not analyse. It is also the largest single bucket in the
# telemetry, which is why it is worth routing at all.
SPEC_MODEL_ROUTES = {
    "pipeline_question": OPENAI_SPEC_LIGHT,
}

OLLAMA_CRED = {"ollamaApi": {"id": "afroOllamaCred01", "name": "Ollama (Afro server)"}}
GROQ_CRED = {"groqApi": {"id": "aAYHFJ3qCZtTe16y", "name": "Groq account"}}

# The credential itself is created in the n8n UI — the API key is never in this
# repo and never passes through the build. Only its id is needed here, and it
# is read from the environment so a rebuild on another n8n instance does not
# need a source edit. Check the current id with:
#   docker exec n8n-n8n-1 node -e "…select id from credentials_entity
#                                  where type='openAiApi'…"
OPENAI_CRED_ID = os.environ.get("ACMS_OPENAI_CRED_ID", "acmsOpenAi01")
OPENAI_CRED_NAME = os.environ.get("ACMS_OPENAI_CRED_NAME", "ACMS OpenAI")
OPENAI_CRED = {"openAiApi": {"id": OPENAI_CRED_ID, "name": OPENAI_CRED_NAME}}

# The knowledge layer. Off by default so the assistant is unchanged on any
# instance without an index behind it — a retrieval tool wired to an empty or
# absent collection is a tool that fails on every call.
RAG = os.environ.get("ACMS_RAG", "0") == "1"
RAG_COLLECTION = os.environ.get("ACMS_RAG_COLLECTION", "acms-knowledge")
EMBED_MODEL = os.environ.get("ACMS_EMBED_MODEL", "text-embedding-3-small")
QDRANT_CRED = {"qdrantApi": {"id": os.environ.get("ACMS_QDRANT_CRED_ID",
                                                  "acmsQdrant01"),
                             "name": "ACMS Qdrant (local)"}}

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "workflows")

nodes = []
connections = {}


def add(node):
    nodes.append(node)
    return node["name"]


def js(code):
    """Inject build-time constants into a Code node's source."""
    return (code
            .replace("__SVC__", SVC_TOKEN)
            .replace("__SPEC_ROUTES__", json.dumps(SPEC_MODEL_ROUTES,
                                                   ensure_ascii=False))
            .replace("__SPEC_DEFAULT__", OPENAI_SPEC_MODEL)
            .replace("__STRUCTURED__", "true" if STRUCTURED else "false"))


def wire(source, target, kind="main", index=0):
    """`index` is the *target's* input slot. It matters for one case: an agent
    with needsFallback exposes two ai_languageModel inputs — 0 is the model it
    uses, 1 is the one it falls back to."""
    connections.setdefault(source, {}).setdefault(kind, [[]])[0].append(
        {"node": target, "type": kind, "index": index}
    )


def from_ai(name, description, kind="string"):
    return f"{{{{ $fromAI('{name}', '{description}', '{kind}') }}}}"


# --------------------------------------------------------------------- tools

REPORTS_API = "http://100.122.6.64:3025"

# The reports service now refuses its own endpoints without this. It cannot bind
# to loopback — the n8n container reaches it over the host's tailscale address —
# so the control is on the request rather than the interface. Kept out of source:
# set ACMS_SVC_TOKEN, or drop the value in n8n/.svc-token beside this script.
SVC_TOKEN = os.environ.get("ACMS_SVC_TOKEN", "").strip()
if not SVC_TOKEN:
    _tok = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".svc-token")
    if os.path.exists(_tok):
        with open(_tok, encoding="utf-8") as _fh:
            SVC_TOKEN = _fh.read().strip()
if not SVC_TOKEN:
    raise SystemExit(
        "ACMS_SVC_TOKEN is not set and n8n/.svc-token is missing — the built "
        "workflow would be unable to call the reports service.")

SVC_HEADER = {"name": "X-ACMS-Svc", "value": SVC_TOKEN}


def propose_tool(node_id, name, description, pos):
    """Proposing an action is a tool call, not a marker in the answer text.

    The marker approach depended on the orchestrator relaying the specialist's
    words verbatim; it paraphrased instead and the marker vanished, so a request
    that looked accepted stored nothing. A tool call is a side effect no
    rewording can lose, and the whitelist that validates it lives in the report
    service where the model cannot reach it.
    """
    return add({
        "parameters": {
            "toolDescription": description,
            "method": "POST",
            "url": REPORTS_API + "/propose",
            "sendHeaders": True,
            "headerParameters": {"parameters": [SVC_HEADER]},
            "sendBody": True,
            "specifyBody": "keypair",
            "bodyParameters": {"parameters": [
                # Comes from the chat, not the model — a session it does not
                # own is not one it can queue an action into.
                {"name": "sessionId",
                 "value": "={{ $('When chat message received').first().json.sessionId }}"},
                {"name": "action",
                 "value": "=" + from_ai("action", "اسم الاجراء مثل contact_create")},
                {"name": "params",
                 "value": "=" + from_ai(
                     "params", "كائن JSON بحقول الاجراء، مثل "
                               "{\"accountId\":\"uuid\",\"fullName\":\"...\"}")},
                {"name": "summary",
                 "value": "=" + from_ai("summary", "وصف عربي قصير لما سيحدث")},
            ]},
            "options": {},
        },
        **TOOL_ERR,
        "type": "n8n-nodes-base.httpRequestTool",
        "typeVersion": 4.2,
        "position": pos,
        "id": node_id,
        "name": name,
    })


def report_tool(node_id, name, description, pos):
    """The report service as a tool.

    Body fields go through `bodyParameters` rather than a hand-built JSON
    string: the narrative is free prose from the model and would break a
    literal template the first time it contained a quote or a newline.
    """
    return add({
        "parameters": {
            "toolDescription": description,
            "method": "POST",
            "url": REPORTS_API + "/generate",
            "sendHeaders": True,
            "headerParameters": {"parameters": [SVC_HEADER]},
            "sendBody": True,
            "specifyBody": "keypair",
            "bodyParameters": {"parameters": [
                {"name": "report",
                 "value": "=" + from_ai("report", "exec_summary او cost_sheet")},
                {"name": "format",
                 "value": "=" + from_ai("format", "pdf او pptx")},
                {"name": "opportunityId",
                 "value": "=" + from_ai("opportunityId",
                                        "معرف الفرصة UUID لتقرير التكلفة فقط، والا اتركه فارغا")},
                {"name": "narrative",
                 "value": "=" + from_ai("narrative",
                                        "تعليق تنفيذي قصير بالعربية يوضع في التقرير، بدون ارقام")},
            ]},
            "options": {},
        },
        **TOOL_ERR,
        "type": "n8n-nodes-base.httpRequestTool",
        "typeVersion": 4.2,
        "position": pos,
        "id": node_id,
        "name": name,
    })


def http_tool(node_id, name, description, path, pos, query=None):
    """A read-only ACMS endpoint as an agent tool.

    Uses the ordinary HTTP Request node in tool form. The langchain
    `toolHttpRequest` node cannot be used on n8n 2.27: it implements only
    `supplyData`, while the agent engine runs tools through the main execution
    path and calls `execute()`, so every call fails with
    "has a supplyData method but no execute method".
    """
    params = {
        "toolDescription": description,
        "url": "=" + API + path,
        "sendHeaders": True,
        "headerParameters": {"parameters": [{"name": "Authorization", "value": AUTH},
                                            SVC_HEADER]},
        "options": {},
    }
    if query:
        params["sendQuery"] = True
        params["queryParameters"] = {
            "parameters": [{"name": q, "value": v} for q, v in query]
        }
    return add({
        "parameters": params,
        **TOOL_ERR,
        "type": "n8n-nodes-base.httpRequestTool",
        "typeVersion": 4.2,
        "position": pos,
        "id": node_id,
        "name": name,
    })


def q_tool(node_id, name, description, resource, pos, query=None):
    """A read tool that goes through the projection layer instead of ACMS.

    n8n hands an httpRequestTool's response straight to the model, so there is
    nowhere in the workflow to trim it: `/opportunities` arrived as 15 records
    of 38 fields — 17,770 characters, ~4,400 tokens — and two such calls put a
    specialist past Groq's 8,000 TPM ceiling. `/q/*` on the reports service
    calls the same ACMS endpoint with this same forwarded token, then returns
    only the fields a view names. Same permissions, a quarter of the payload.

    A second gain: ACMS rejects an unknown or empty query param with a 400, so
    every filter here had to be mandatory. `/q/*` skips empty ones, which lets
    a filter be genuinely optional.
    """
    query = list(query or [])
    # Names the session so /q can record what it handed over; the output guard
    # checks the answer against that. A fixed expression, never $fromAI — an
    # extra required property is what broke the tool schema in phase 4.
    query.append(("session",
                  "={{ $('When chat message received').first().json.sessionId }}"))
    params = {
        "toolDescription": description,
        "url": "=" + REPORTS_API + "/q/" + resource,
        "sendHeaders": True,
        "headerParameters": {"parameters": [{"name": "Authorization", "value": AUTH},
                                            SVC_HEADER]},
        "options": {},
    }
    if query:
        params["sendQuery"] = True
        params["queryParameters"] = {
            "parameters": [{"name": q, "value": v} for q, v in query]
        }
    return add({
        "parameters": params,
        **TOOL_ERR,
        "type": "n8n-nodes-base.httpRequestTool",
        "typeVersion": 4.2,
        "position": pos,
        "id": node_id,
        "name": name,
    })


STAGES = ("LEAD_INTAKE, LEAD_QUALIFICATION, OPPORTUNITY_QUALIFICATION, SCOPE_DISCOVERY, "
          "BID_STRATEGY_SOLUTION, COSTING_SOURCING, OPERATIONAL_FINANCIAL_REVIEW, "
          "MANAGEMENT_APPROVAL, PROPOSAL_SUBMISSION, CLARIFICATIONS_NEGOTIATION, "
          "AWARD_CONTRACTING, PROJECT_HANDOVER, ACTUAL_PERFORMANCE_FEEDBACK")

# Rules assembled per agent, not one block copied into all six.
#
# The block had grown to 971 characters — 286 tokens — and every specialist
# carried all of it, including the parts that could never apply to it. The
# governance agent was told how to compute a margin; the report agent was told
# about a `facts` field none of its two tools returns; and the action agent,
# whose entire purpose is proposing changes, was told it was "in read-only
# mode". That last one was not just waste, it was a contradiction.
#
# These are separate LLM calls, so the duplication costs nothing *within* a
# call — but it is billed against the same per-minute and per-day budget every
# time a turn fans out, which is where the real cost sits.

RULE_EVIDENCE = (
    "- لا تذكر أي رقم أو اسم أو حالة إلا إذا رجع من أداة استدعيتها الآن. ممنوع التخمين.\n"
    "- نتيجة فاضية معناها \"لا توجد بيانات في النظام\" — مش صفر ومش تقدير.\n"
    "- اذكر مع كل رقم أو استنتاج مصدره: كود السجل أو معرّفه (مثل OPP-2026-000013 "
    "أو ACC-2026-000006). استنتاج بلا سجل يسنده لا يُذكر.\n"
)

# Tools return their failures instead of aborting the run, so the agent has to
# be told the difference between "the tool said nothing" and "the tool broke" —
# otherwise a failed read reads as an empty result.
RULE_ERRORS = (
    "- لو رجع في رد أداة حقل error فالأداة فشلت: قل ذلك صراحة ولا تعتبرها نتيجة "
    "فارغة ولا تكمل الناقص من عندك.\n"
    "- لو جاء في الرد truncated=true فما وصلك جزء من السجلات لا كلها — قل ذلك.\n"
)

# Only for agents holding a tool that actually returns `facts` — the /q reads.
RULE_FACTS = (
    "- حقل facts في رد الأداة **محسوب من النظام**: اقتبسه كما هو وممنوع أن تعيد "
    "حسابه أو تستنتج بديلًا عنه — وخصوصًا أيام آخر تواصل (daysSinceContact و"
    "neverContacted) وعدد المتأخرات (overdueCount). لو حقل محسوب غير موجود فقل "
    "إنه غير متاح بدل أن تحسبه بنفسك.\n"
)

# Only where money or opportunity shape is actually discussed.
RULE_MONEY = (
    "- الهامش يُحسب على سعر البيع لا على التكلفة (Margin ≠ Markup).\n"
    "- اعرض المبالغ بعملتها ولا تحوّل بين العملات.\n"
)
RULE_SHAPE = (
    "- stage و status و forecastCategory و health أربع صفات مختلفة للفرصة، لا تخلط بينها.\n"
)
RULE_READONLY = "- أنت في وضع قراءة فقط: لا إنشاء ولا تعديل ولا حذف.\n"


def rules(*parts):
    return "قواعد ملزمة:\n" + "".join(parts).rstrip("\n")


READ_RULES = rules(RULE_EVIDENCE, RULE_SHAPE, RULE_MONEY, RULE_READONLY,
                   RULE_ERRORS, RULE_FACTS)

# Kept deliberately short: this prompt ships on every routing call, and the
# shared Groq tier meters 8000 tokens/minute. The detailed domain rules live in
# each specialist instead, where they are only paid for when that agent runs.
ORCH_PROMPT = (
    "أنت منسّق \"ACMS Agent\" لمنظومة أفرو التجارية. أنت لا تملك بيانات — توجّه فقط.\n\n"
    "الوكلاء:\n"
    "- sales_intelligence: الفرص، الحسابات، الأنشطة، مواعيد المناقصات.\n"
    "- financial_intelligence: التكلفة، التسعير، الهوامش، عروض الموردين.\n"
    "- executive_reporting: المؤشرات وملخصات الإدارة وشرح المؤشرات.\n"
    # "الموافقات" alone sent «وافق على أول طلب موافقة» here, and this agent is
    # genuinely read-only, so it refused — correctly for itself, wrongly for the
    # user, who had asked for a decision. Viewing approvals and deciding them are
    # different jobs and belong to different agents; the list has to say so.
    "- compliance_and_approval: **عرض** ما ينتظر موافقة، والتدقيق والحوكمة "
    "والقيم المرجعية. قراءة فقط — لا يبتّ في شيء.\n"
    "- action_agent: أي طلب تغيير (مرحلة، حالة، تحديث بيانات، نشاط، إنشاء حساب أو "
    "جهة اتصال أو فرصة). **وكل بتّ في موافقة أو خصم — «وافق»، «اعتمد»، «ارفض» "
    "— يذهب إليه هو لا إلى compliance_and_approval.** يجهّز اقتراحًا فقط ولا ينفّذ.\n"
    "- report_agent: توليد ملف تقرير جاهز — ملخّص تنفيذي أو ورقة تكلفة، بصيغة PDF "
    "أو PowerPoint، ويُعيد رابط التحميل.\n"
    + ("- acms_knowledge_search: أداة بحث في وثائق الشركة المكتوبة — السياسات "
       "وإجراءات التشغيل والقوالب والأدلة. ليست وكيلًا.\n"
       if RAG else "")
    + "\nقواعد:\n"
    + ("- **حدّ فاصل لا يُتجاوز:** ACMS مصدر بيانات النظام، والوثائق مصدر "
       "المعرفة المكتوبة. أي سؤال عن فرصة أو حساب أو نشاط أو تكلفة أو هامش أو "
       "مؤشر أو حالة سجل يُجاب من وكلاء ACMS **وحدهم**، ولو وجدت الرقم في وثيقة "
       "فالوثيقة قديمة والنظام هو الصحيح. وأي سؤال عن سياسة أو إجراء أو تعريف "
       "مكتوب يُجاب من acms_knowledge_search.\n"
       "- عند الاستشهاد بوثيقة اذكر عنوانها.\n"
       if RAG else "")
    + "- ممنوع الرد على أي سؤال عن النظام قبل استدعاء وكيل فعليًا. الرد من عندك خطأ فادح.\n"
    "- ممنوع ادّعاء أنك سألت وكيلًا أو أن إجراءً نُفِّذ. انقل رد الوكيل حرفيًا.\n"
    "- \"لا توجد بيانات\" لا تُقال إلا إذا قالها وكيل.\n"
    "- عند التردد استدعِ الأقرب بدل الامتناع. ممنوع اختراع رقم أو اسم.\n"
    # Caught in testing: with the daily Groq quota exhausted, action_agent
    # returned {"error":"The service is receiving too many requests from you"}
    # and the orchestrator relayed it to the user as «تم إرسال طلبك إلى النظام»
    # — a failed call reported as a success, which is the one thing this system
    # exists to prevent. The specialists already carry this rule; the
    # orchestrator needs its own copy because it sees the error, not the tool.
    # Scoped to the *final* result on purpose. The first version said "any
    # error means failure", and a call that failed once, retried and then
    # succeeded came back as «فشل إنشاء الفرصة» printed directly above a valid
    # proposal and its confirmation code — the opposite mistake, equally wrong.
    "- احكم على **آخر** ردّ من الوكيل وحده. إن كان الأخير حقل error أو رسالة فشل "
    "فالوكيل لم يعمل: انقل الفشل صراحة واذكر أنه لم يحدث أي تغيير، وممنوع منعًا "
    "باتًا صياغته كأنه نجح أو «قيد التنفيذ» أو «بانتظار التأكيد». وإن نجح بعد "
    "محاولة فاشلة فاعتمد الناجحة ولا تذكر الفاشلة أصلًا.\n"
    # The specialists return fields rather than prose *only when STRUCTURED is
    # on*. Relaying the object verbatim would put JSON in front of the user, so
    # the orchestrator is told which field is the sentence and what to do with
    # the rest — but describing an object that is not there is just as wrong,
    # which is why these lines are tied to the same constant as the parser node
    # instead of being left in the prompt permanently.
    + ("- ردّ الوكيل يصل ككائن فيه answer وقد يحوي risks وrecommendations "
       "وlimitations. **اعرض answer كما هو** ولا تعرض الكائن نفسه ولا أسماء "
       "الحقول.\n"
       "- ألحِق بعده — عند وجودها — المخاطر ثم التوصيات ثم الحدود، كنقاط قصيرة. "
       "وإن كانت limitations غير فارغة فاذكرها ولا تُسقطها.\n"
       # No line about evidence any more, and that is deliberate: the sources
       # are attached by the system after the answer, from what was actually
       # served. Telling the orchestrator to judge them would put the model back
       # in a job it was measured to be unreliable at.
       if STRUCTURED else "")
    + "- رد بلغة السؤال وبإيجاز، وبجدول لأي قائمة أطول من صفين."
)

# Two tries, not five. The failures seen in production were Groq's 413 and 429,
# and repeating the same oversized request can only fail again while eating more
# of the same per-minute budget — five attempts turned a fast failure into a
# slow one. One retry covers a genuine blip; anything past that is the fallback
# model's job.
RETRY = {"retryOnFail": True, "maxTries": 2, "waitBetweenTries": 5000}

# A failed read should cost the answer a fact, not the whole turn. With this the
# tool hands the agent an error item it can report; without it the run aborts and
# the user sees n8n's raw message. It pairs with the rule added to RULES below —
# the agent must say a tool failed rather than fill the gap itself.
TOOL_ERR = {"onError": "continueRegularOutput"}


# ------------------------------------------------------------------ backbone

add({
    "parameters": {
        "public": True,
        "initialMessages": (
            "أهلًا 👋 أنا **ACMS Agent** — منسّق منظومة أفرو التجارية.\n\n"
            "ورايا أربع وكلاء متخصصين: المبيعات، المالي، التقارير التنفيذية، "
            "والالتزام والموافقات.\n\n"
            "جرّب:\n"
            "• اعرض الفرص المفتوحة ومراحلها\n"
            "• إيه مؤشرات الأداء دلوقتي؟ ويعني إيه Weighted Pipeline؟\n"
            "• فيه مناقصات قافلة خلال 60 يوم؟\n"
            "• إيه اللي مستني موافقة؟\n\n"
            "• ارفع كراسة شروط أو BOQ وأنا ألخّصها لك\n\n"
            "ملاحظة: أي تغيير في النظام يحتاج تأكيدك برقم قبل أن ينفَّذ."
        ),
        "options": {
            "allowFileUploads": True,
            "allowedFilesMimeTypes": (
                "application/pdf,"
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,"
                "application/vnd.ms-excel,"
                "application/vnd.oasis.opendocument.spreadsheet,"
                "text/csv,text/plain"
            ),
        },
    },
    "type": "@n8n/n8n-nodes-langchain.chatTrigger",
    "typeVersion": 1.4,
    "position": [-1560, 0],
    "id": "orch-trigger",
    "name": "When chat message received",
    "webhookId": WEBHOOK_ID,
})

# Resolving *who is asking*, not logging a robot in.
#
# It keeps the node name and its output field, so all sixteen tools continue to
# read `$('ACMS Login').first().json.accessToken` untouched — what changes is
# whose token that is. ACMS has no impersonation endpoint, so a personal token
# can only come from that person's own credentials; they are exchanged in the
# browser against the reports service and never enter the chat or n8n. What
# arrives here is a six-character binding code, used once.
LOGIN_JS = r"""
const chat = $('When chat message received').first().json;
const sessionId = String(chat.sessionId || 'default');
const message = String(chat.chatInput || '').trim();
const SVC = { 'X-ACMS-Svc': '__SVC__' };
const BASE = 'http://100.122.6.64:3025/identity/';

// `/login CODE` is handled here rather than in the gate so the very turn that
// binds is already answered as the right person.
let justBound = null;
const m = message.match(/^\/login\s+([A-Za-z0-9]{6})\s*$/);
if (m) {
  try {
    const res = await this.helpers.httpRequest({
      method: 'POST', url: BASE.replace(/\/$/, '') + '/bind', headers: SVC,
      body: { code: m[1].toUpperCase(), sessionId }, json: true,
    });
    justBound = res && res.ok ? { email: res.email, roles: res.roles } : { error: (res || {}).error };
  } catch (e) {
    justBound = { error: 'تعذّر ربط الجلسة' };
  }
}

let who = { identified: false, accessToken: null, mode: 'optional' };
try {
  who = await this.helpers.httpRequest({
    method: 'GET', url: BASE + encodeURIComponent(sessionId), headers: SVC, json: true,
  });
} catch (e) { /* identity service down — handled below */ }

if (!who.accessToken) {
  // Nothing to act with. Say so rather than failing obscurely three nodes later.
  return [{ json: {
    accessToken: null, identified: false, mode: who.mode || 'required',
    loginRequired: true,
    output: (justBound && justBound.error ? '⚠️ ' + justBound.error + '\n\n' : '')
      + 'سجّل الدخول أولًا: افتح ' + 'http://100.122.6.64:3025/login'
      + ' بحسابك، ثم اكتب هنا الرمز الظاهر (مثال: /login A6C3EN).',
  } }];
}

return [{ json: {
  accessToken: who.accessToken,
  identified: !!who.identified,
  email: who.email || null,
  roles: who.roles || null,
  mode: who.mode,
  justBound,
} }];
"""

add({
    "parameters": {"jsCode": js(LOGIN_JS)},
    "type": "n8n-nodes-base.code",
    "typeVersion": 2,
    "position": [-1340, 0],
    "id": "acms-login",
    "name": "ACMS Login",
    "notes": "يحل هوية صاحب الجلسة ويعيد توكنه — لا يسجّل دخول حساب خدمة.",
})

add({
    "parameters": {
        "promptType": "define",
        # Read from the gate, not from the trigger: the gate is where the
        # message got bounded, and the trigger still holds the unbounded text.
        # The hint prefix is empty unless a routing rule was confident.
        "text": ("={{ $('Approval Gate').first().json.businessContext }}"
                 "{{ $('Approval Gate').first().json.routingHint }}"
                 "{{ $('Approval Gate').first().json.userMessage }}"),
        "needsFallback": FALLBACK_CHAT,
        "options": {"systemMessage": ORCH_PROMPT},
    },
    **RETRY,
    "onError": "continueRegularOutput",
    "type": "@n8n/n8n-nodes-langchain.agent",
    "typeVersion": 3.1,
    "position": [-460, 0],
    "id": "orch-agent",
    "name": "ACMS Orchestrator",
})

wire("When chat message received", "ACMS Login")


# ------------------------------------------------- human approval, in-chat
#
# Writes are never issued by the model. The action agent can only *propose*: it
# emits a marker, and `Capture Proposal` turns that into a whitelisted request
# stored under the chat session with a one-time 4-digit code. Only when the user
# types that code back does `Approval Gate` route to a fixed HTTP node that
# replays the stored request. At execution time the model is not in the loop at
# all, so it cannot change the target, the endpoint, or the payload.

GATE_JS = r"""
const login = $input.first().json;
const chat = $('When chat message received').first().json;
const sessionId = String(chat.sessionId || 'default');
const message = String(chat.chatInput || '');

// Identity resolves before anything else can matter: with no token there is
// nothing to read ACMS with, and a turn that just bound one should say who it
// now belongs to. Both answer from here, so neither costs a model call.
if (login.loginRequired) {
  return [{ json: { route: 'reply', action: null, sessionId,
                    userMessage: message, messageTruncated: false,
                    intent: { intent: 'login_required', agent: null,
                              confidence: 1, action_required: false, entities: {} },
                    businessContext: '', routingHint: '',
                    accessToken: null, output: login.output,
                    hasFile: false, fileName: null, fileExt: null, binaryKey: null } }];
}
if (login.justBound && !login.justBound.error) {
  const roles = (login.justBound.roles || [])
    .map(function (r) { return r.role + (r.scope ? '/' + r.scope : ''); }).join('، ');
  return [{ json: { route: 'reply', action: null, sessionId,
                    userMessage: message, messageTruncated: false,
                    intent: { intent: 'login_ok', agent: null, confidence: 1,
                              action_required: false, entities: {} },
                    businessContext: '', routingHint: '',
                    accessToken: login.accessToken,
                    output: '✅ تم ربط الجلسة بحسابك: **' + login.justBound.email + '**'
                      + (roles ? '\n\nالصلاحيات: ' + roles : '')
                      + '\n\nمن الآن ما تراه وما تنفّذه بصلاحياتك أنت، ويُسجَّل باسمك في التدقيق.',
                    hasFile: false, fileName: null, fileExt: null, binaryKey: null } }];
}

// The pending proposal lives in the report service, not in n8n's workflow
// static data: writes to static data did not survive between executions here,
// so a confirmed action found nothing to run and silently did nothing.
// `/claim` checks the code and removes the proposal in one locked step, so a
// code cannot be replayed and two confirmations cannot both win.
let route = 'chat';
let action = null;

const codes = message.match(/\d{4}/g) || [];
for (const code of codes) {
  const res = await this.helpers.httpRequest({
    method: 'POST',
    url: 'http://100.122.6.64:3025/pending/' + encodeURIComponent(sessionId) + '/claim',
    headers: { 'X-ACMS-Svc': '__SVC__' },
    body: { code },
    json: true,
  });
  if (res && res.claimed) {
    route = 'execute';
    action = res.proposal;
    break;
  }
}

// The uploaded file rides on the trigger item, not on the login response, so
// carry the binary forward or the extract nodes downstream have nothing to read.
const trigger = $('When chat message received').first();
const files = (trigger.json && trigger.json.files) || [];
const file = files[0] || null;

// Whatever the session already established — which opportunity, which account.
// Read every turn, so a follow-up ("حدّث احتمالها 60") carries the id with it
// instead of hoping it is still legible somewhere in the transcript.
let businessContext = '';
try {
  const c = await this.helpers.httpRequest({
    method: 'GET',
    url: 'http://100.122.6.64:3025/context/' + encodeURIComponent(sessionId),
    headers: { 'X-ACMS-Svc': '__SVC__' },
    json: true,
  });
  const x = (c && c.context) || null;
  if (x && x.opportunityId) {
    businessContext = '[السياق الجاري — الفرصة '
      + (x.opportunityCode || '')
      + (x.opportunityName ? ' «' + x.opportunityName + '»' : '')
      + '، opportunityId: ' + x.opportunityId
      + '. استخدمه مباشرة لأي متابعة على نفس الفرصة، ولا تبحث عنها من جديد.]\n';
  }
} catch (e) { /* no context service, no context line — the turn still works */ }

// Screen what is about to enter a prompt. A tender PDF is the realistic
// carrier for an instruction aimed at the model rather than at a reader.
let guardIn = null;
try {
  guardIn = await this.helpers.httpRequest({
    method: 'POST', url: 'http://100.122.6.64:3025/guard/input',
    headers: { 'X-ACMS-Svc': '__SVC__' },
    body: { text: message }, json: true,
  });
} catch (e) { /* guard down — the turn proceeds, and telemetry shows the gap */ }
if (guardIn && guardIn.verdict === 'block') {
  return [{ json: { route: 'reply', action: null, sessionId,
                    userMessage: message, messageTruncated: false,
                    intent: { intent: 'blocked_input', agent: null, confidence: 1,
                              action_required: false, entities: {} },
                    businessContext: '', routingHint: '',
                    accessToken: login.accessToken,
                    output: '⛔ الطلب يحتوي على تعليمات موجَّهة للنظام نفسه '
                          + '(' + (guardIn.findings || []).join('، ') + ') ولم يُنفَّذ. '
                          + 'أعد صياغته كسؤال عن البيانات.',
                    hasFile: false, fileName: null, fileExt: null, binaryKey: null } }];
}

// ---------------------------------------------------------------- intent
//
// Deterministic first, model second. Two things are worth deciding in code:
//
// 1. Whether the message needs the system at all. "شكرًا" does not, and running
//    an orchestrator plus a specialist over it costs a full round trip and real
//    tokens against a budget that has a daily ceiling. This branch answers with
//    zero model calls.
// 2. Which specialist the question belongs to. Measured before writing this:
//    32 of 38 real questions already dispatched exactly one agent, so routing
//    was not the problem the audit guessed it was — the hint is therefore a
//    hint, passed only when a rule is confident, and never a bypass. The
//    orchestrator still decides.
//
// Everything the rules cannot settle falls through untouched, which is what
// keeps this safe to add.
const norm = message
  .replace(/[ً-ْـ]/g, '')     // harakat and tatweel
  .replace(/[إأآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[^\p{L}\p{N}\s]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const SMALL_TALK = [
  'السلام عليكم', 'وعليكم السلام', 'سلام', 'اهلا', 'اهلا وسهلا', 'هاي', 'مرحبا',
  'صباح الخير', 'مساء الخير', 'ازيك', 'عامل ايه',
  'شكرا', 'شكرا جزيلا', 'متشكر', 'تسلم', 'تمام', 'ماشي', 'اوك', 'اوكي',
  'حلو', 'جميل', 'ممتاز', 'مع السلامه', 'باي',
  'hi', 'hello', 'hey', 'thanks', 'thank you', 'thx', 'ok', 'okay', 'bye',
];
const CAPABILITY = [
  'مين انت', 'انت مين', 'تقدر تعمل ايه', 'ايه اللي تقدر تعمله', 'ماذا تستطيع',
  'ايه امكانياتك', 'مساعده', 'help', 'what can you do', 'who are you',
];

// Deliberately narrow: an exact match on a short message with no digits in it.
// A question that merely *contains* "تمام" is still a question.
const short = norm.length <= 30 && !/\d/.test(norm);
const isSmallTalk = short && SMALL_TALK.includes(norm);
const isCapability = CAPABILITY.includes(norm);

// Substring matching, not word boundaries. JavaScript's \b is defined over
// [A-Za-z0-9_], so every Arabic-only pattern written with \b matched nothing at
// all — the first version of these rules passed only the cases that happened to
// contain a Latin word. Substrings also suit the language: Arabic glues its
// articles and prepositions on, so "الفرص" and "بالمؤشرات" have to hit the same
// stems as "فرص" and "مؤشرات".
//
// Order is the disambiguator, most specific first: an action verb outranks the
// noun it acts on, and a request for a *file* outranks the topic that file is
// about — "صدّر ورقة التكلفة" is a report request, not a costing question.
const RULES = [
  ['action_agent', 'change_request',
   ['انشئ', 'انشاء', 'اضف', 'اضافه', 'عدل', 'تعديل', 'حدث', 'تحديث', 'تغيير',
    // "وافق علي" and not bare "وافق": "موافقة" contains it, so the bare stem
    // sent "إيه اللي مستني موافقة؟" — a plain read — to the action agent.
    'انقل', 'نقل', 'احذف', 'حذف', 'اعتمد', 'وافق علي', 'ارفض', 'سجل نشاط']],
  ['report_agent', 'report_request',
   ['تقرير', 'تقارير', 'ملف', 'بي دي اف', 'pdf', 'pptx', 'powerpoint',
    'عرض تقديمي', 'صدر', 'تصدير', 'حملي', 'ابعتلي']],
  ['executive_reporting', 'kpi_question',
   ['مؤشر', 'مؤشرات', 'kpi', 'weighted', 'win rate', 'forecast', 'ملخص',
    'للاداره', 'المدير التنفيذي', 'ceo']],
  ['financial_intelligence', 'financial_question',
   ['تكلفه', 'تكاليف', 'هامش', 'هوامش', 'سعر', 'اسعار', 'تسعير', 'ربحيه',
    'مورد', 'موردين', 'مقارنه عروض']],
  ['compliance_and_approval', 'governance_question',
   ['موافقه', 'موافقات', 'تدقيق', 'حوكمه', 'فصل المهام', 'sod', 'صلاحيه',
    'صلاحيات']],
  ['sales_intelligence', 'pipeline_question',
   ['فرصه', 'فرص', 'pipeline', 'عميل', 'عملاء', 'حساب', 'حسابات', 'نشاط',
    'انشطه', 'تواصل', 'مناقصه', 'مناقصات', 'موعد', 'مواعيد', 'مرحله', 'مراحل']],
];

let agentHint = null;
let intentName = 'unknown';
let confidence = 0;
for (const [agent, name, stems] of RULES) {
  if (stems.some((w) => norm.includes(w))) {
    agentHint = agent; intentName = name; confidence = 0.8; break;
  }
}
if (isSmallTalk) { intentName = 'small_talk'; agentHint = null; confidence = 1; }
if (isCapability) { intentName = 'capability_question'; agentHint = null; confidence = 1; }
if (route === 'execute') { intentName = 'confirmation'; agentHint = null; confidence = 1; }

// Entities the model would otherwise have to re-derive from the sentence.
const COUNTRIES = { مصر: 'EG', السودان: 'SD', كينيا: 'KE', مدغشقر: 'MG', 'جزر القمر': 'KM' };
const entities = {};
for (const [ar, code] of Object.entries(COUNTRIES)) if (norm.includes(ar)) entities.country = code;
const cc = message.match(/\b(EG|SD|KE|MG|KM)\b/);
if (cc) entities.country = cc[1];
const st = message.match(/\b(ACTIVE|LOST|CLOSED|CANCELLED|ON_HOLD)\b/);
if (st) entities.status = st[1];
const days = norm.match(/(\d+)\s*(يوم|ايام|day)/);
if (days) entities.days = Number(days[1]);

const intent = {
  intent: intentName,
  agent: agentHint,
  confidence,
  action_required: intentName === 'change_request',
  entities,
};

// Which model the specialists run for this turn. Decided here, in code, from
// the intent that was already computed above — the model never chooses its own
// size. An intent that is not in the table gets the large model.
const SPEC_MODEL_ROUTES = __SPEC_ROUTES__;
const specModel = SPEC_MODEL_ROUTES[intentName] || '__SPEC_DEFAULT__';

// Which document classes this turn may retrieve. Computed here, in code, from
// the identity the login node resolved — never from the question and never from
// the model. The knowledge tool's filter reads this field, so a class absent
// from the list cannot be reached no matter how the question is phrased.
//
// Everyone gets `internal`. `confidential` is deliberately unreachable until
// two things are true together: documents of that class are actually indexed,
// and ACMS_IDENTITY_MODE is `required` — because while it is `optional` every
// unbound session resolves to the same service account, so a per-identity
// filter would look like a control and enforce nothing.
const ragClasses = ['internal'];


// The two cases the model is not needed for at all.
let cannedReply = null;
if (isSmallTalk) {
  cannedReply = 'أهلًا 👋 اسألني عن الفرص أو المؤشرات أو التكلفة أو ما ينتظر موافقة، '
              + 'أو ارفع كراسة شروط لأحللها.';
} else if (isCapability) {
  cannedReply = 'أنا مساعد **ACMS**. أقدر أجاوب عن:\n'
              + '• الفرص والـpipeline ومراحلها ومواعيد المناقصات\n'
              + '• التكلفة والهوامش ومقارنة عروض الموردين\n'
              + '• مؤشرات الأداء وملخصات الإدارة\n'
              + '• الموافقات والتدقيق والحوكمة\n'
              + '• توليد تقرير PDF أو PowerPoint\n'
              + '• تحليل كراسة شروط أو BOQ ترفعها\n\n'
              + 'وأقدر أجهّز تغييرات في النظام — لكنها لا تُنفَّذ إلا بعد أن تكتب رقم التأكيد.';
}
if (cannedReply && route !== 'execute') {
  route = 'reply';
}

// The answer cache. Only read questions are eligible: a confirmation, a change
// request and a report each have a side effect or a file behind them, and an
// `unknown` intent is by definition a question we could not classify — replaying
// an answer to one would be guessing twice. A turn carrying a file is never
// eligible either, because the file, not the sentence, is the question.
//
// A hit is answered here, before the orchestrator exists for this turn: no
// dispatch, no tool call, no tokens. Staleness is handled on the service side —
// the entry carries a fingerprint of the data it came from and is discarded the
// moment that data moves — so nothing here needs to reason about freshness.
// The regression harness is excluded on purpose. Its sessions are fresh each
// run but the cache is keyed on user and question, not session — so from the
// second run onward the suite would be scoring answers it had produced itself,
// at a tenth of the latency, and a broken agent would still pass. A test suite
// that can hit its own cache measures nothing.
const CACHEABLE = ['pipeline_question', 'kpi_question', 'financial_question'];
const isHarness = /^rg\d/.test(sessionId);
const cacheUser = login.email || 'svc';
let cacheHit = false;
if (route === 'chat' && !file && !isHarness && CACHEABLE.includes(intentName)) {
  try {
    const r = await this.helpers.httpRequest({
      method: 'POST', url: 'http://100.122.6.64:3025/cache/lookup',
      headers: { 'X-ACMS-Svc': '__SVC__' },
      body: { user: cacheUser, question: message }, json: true, timeout: 4000,
    });
    if (r && r.hit && r.answer) {
      cacheHit = true;
      route = 'reply';
      // Marked, not hidden. An answer the user is told is an hour old is a
      // different thing from one presented as fresh.
      cannedReply = r.answer + '\n\n---\n_إجابة محفوظة من قبل '
                  + (r.ageMin || 0) + ' دقيقة — البيانات لم تتغيّر منذ ذلك الحين._';
    }
  } catch (e) { /* cache unavailable: answer the question normally */ }
}

// A bound on the question itself, decided here in code rather than discovered
// later by the model. A 77,000-character message was refused by Groq (413) and
// then handed to the Ollama fallback, whose context window is *smaller* — it
// ran for 457 seconds and returned a single Arabic letter. A slow wrong answer
// is worse than a fast honest one, so the text is cut to something that fits
// and the model is told plainly that it was cut.
const MAX_CHARS = 8000;
let userMessage = message;
let messageTruncated = false;
if (userMessage.length > MAX_CHARS) {
  userMessage = userMessage.slice(0, MAX_CHARS)
    + '\n\n[نص السؤال طويل جدًا وقُطع هنا — أجب عن الجزء الظاهر فقط، وابدأ ردّك '
    + 'بتنبيه أن السؤال اختُصر وأن على المستخدم تقسيمه أو رفعه كملف.]';
  messageTruncated = true;
}

return [{
  json: {
    route,
    action,
    sessionId,
    userMessage,
    messageTruncated,
    intent,
    specModel,
    ragClasses,
    cacheHit,
    cacheUser,
    cacheable: route === 'chat' && !file && !isHarness
               && CACHEABLE.includes(intentName),
    businessContext,
    // Only when a rule was confident, and only as one short line — the
    // orchestrator is free to ignore it, and an unhinted turn behaves exactly
    // as it did before this existed.
    routingHint: intent.agent
      ? '[توجيه مقترح آليًا: ' + intent.agent + ' — تجاهله لو بدا خاطئًا]\n'
      : '',
    output: cannedReply,
    accessToken: login.accessToken,
    hasFile: !!file,
    fileName: file ? file.fileName : null,
    fileExt: file ? String(file.fileExtension || '').toLowerCase() : null,
    binaryKey: file ? file.binaryKey : null,
  },
  binary: trigger.binary || {},
}];
"""

CAPTURE_JS = r"""
const chat = $('When chat message received').first().json;
const sessionId = String(chat.sessionId || 'default');

// The agent nodes run with onError=continueRegularOutput, so a failure arrives
// here as an item carrying `error` instead of aborting the execution. Without
// this the user saw n8n's own text — "Your request is invalid or could not be
// processed by the service" — which names neither the cause nor anything they
// could do about it. Groq's two real failure modes are worth separating: 413 is
// one oversized question, 429 is a minute's budget already spent.
const failed = $input.first().json.error;
if (failed) {
  const detail = String(
    (failed && (failed.message || failed.description)) || failed || ''
  );
  let msg;
  if (/too large|413|context/i.test(detail)) {
    msg = 'السؤال أكبر من ميزانية النموذج في هذه الجولة. اسأل عن نطاق أضيق — '
        + 'حالة واحدة أو فرصة بعينها — وسيعمل.';
  } else if (/rate limit|429/i.test(detail)) {
    msg = 'وصلنا حد الطلبات في هذه الدقيقة. أعد المحاولة بعد نحو دقيقة.';
  } else if (/ECONNREFUSED|ETIMEDOUT|socket|network|fetch failed/i.test(detail)) {
    msg = 'تعذّر الوصول إلى النظام الآن — على الأرجح انقطاع مؤقت في الخدمة. '
        + 'أعد المحاولة بعد قليل.';
  } else {
    msg = 'حدث خطأ أثناء معالجة الطلب ولم يُنفَّذ أي تغيير.';
  }
  return [{ json: { output: '⚠️ ' + msg + '\n\n`' + detail.slice(0, 200) + '`' } }];
}

let out = String($input.first().json.output || '');
// A relayed specialist answer sometimes arrives as the raw tool result.
try {
  const parsed = JSON.parse(out);
  if (Array.isArray(parsed) && parsed.length && typeof parsed[0].output === 'string') {
    out = parsed[0].output;
  } else if (parsed && typeof parsed.output === 'string') {
    out = parsed.output;
  }
} catch (e) { /* plain text — the normal case */ }

// …and sometimes with its newlines still escaped, which renders as a literal \n.
if (out.indexOf('\\n') !== -1 && out.indexOf('\n') === -1) {
  out = out.replace(/\\n/g, '\n').replace(/\\"/g, '"');
}

// The proposal itself was created by the action agent calling
// acms_propose_action, which validated it against the whitelist in the report
// service and stored it. All that is left here is to announce it — `announce=1`
// hands each proposal over exactly once, so the block appears on the turn it
// was created and never repeats.
let res = null;
try {
  res = await this.helpers.httpRequest({
    method: 'GET',
    url: 'http://100.122.6.64:3025/pending/' + encodeURIComponent(sessionId) + '?announce=1',
    headers: { 'X-ACMS-Svc': '__SVC__' },
    json: true,
  });
} catch (e) { /* no service, no block — the answer still goes out */ }

// Screen the answer against the evidence this session was actually shown. The
// prompt already tells the agent not to cite what it was not given; this is the
// part that does not depend on the model agreeing.
async function screened(text, hasCode) {
  try {
    const g = await this.helpers.httpRequest({
      method: 'POST', url: 'http://100.122.6.64:3025/guard/output',
      headers: { 'X-ACMS-Svc': '__SVC__' },
      body: { answer: text, sessionId, hasPendingCode: !!hasCode }, json: true,
    });
    if (!g || g.verdict === 'pass') return text;
    const why = (g.findings || []).map(function (f) { return f.kind; }).join(', ');
    if (g.verdict === 'block') {
      return '⛔ حُجبت الإجابة قبل إرسالها (' + why + '). لم يحدث أي تغيير.';
    }
    return text + '\n\n---\n⚠️ **تنبيه تدقيق:** ' + why;
  } catch (e) {
    return text;   // guard unavailable: the answer still goes out
  }
}

// What the system actually served this session, read from the evidence ledger
// rather than restated by the model. Appended after screening, not before: the
// guard's job is to catch codes the session was never given, and feeding it the
// ledger's own codes would make that check answer itself.
async function sources() {
  if (!__STRUCTURED__) return '';
  try {
    const r = await this.helpers.httpRequest({
      method: 'GET',
      url: 'http://100.122.6.64:3025/evidence/' + encodeURIComponent(sessionId),
      headers: { 'X-ACMS-Svc': '__SVC__' }, json: true, timeout: 4000,
    });
    const ev = r && r.evidence;
    const list = (ev && ev.sources) || [];
    if (!list.length) return '';
    const seen = new Set();
    const parts = [];
    for (const s of list) {
      const ep = String(s.endpoint || '');
      if (!ep || seen.has(ep)) continue;
      seen.add(ep);
      let n = '';
      if (s.returned != null && s.total != null) n = ' (' + s.returned + '/' + s.total + ')';
      else if (s.returned != null) n = ' (' + s.returned + ')';
      parts.push('`' + ep + '`' + n + (s.truncated ? ' ✂︎' : ''));
    }
    if (!parts.length) return '';
    const codes = (ev.codes || []).length;
    return '\n\n---\n_المصادر: ' + parts.join(' · ')
         + (codes ? ' — ' + codes + ' سجلًا' : '') + '_';
  } catch (e) {
    return '';   // ledger unavailable: the answer still goes out, unsourced
  }
}

if (!res || !res.fresh || !res.proposal) {
  const answer = (await screened.call(this, out, false)) + (await sources.call(this));
  // Store only a clean read answer. Anything the guard touched, anything that
  // reads as a failure, and anything carrying a confirmation number must never
  // be replayed to a later turn — a stored refusal would outlive its cause, and
  // a stored code would be a second chance at a single-use claim.
  const gate = $('Approval Gate').first().json;
  const storable = gate.cacheable && !gate.cacheHit
    && !/^⚠️|^⛔/.test(answer)
    && !/تنبيه تدقيق|اكتب الرقم/.test(answer);
  if (storable) {
    try {
      await this.helpers.httpRequest({
        method: 'POST', url: 'http://100.122.6.64:3025/cache/store',
        headers: { 'X-ACMS-Svc': '__SVC__' },
        body: { user: gate.cacheUser, question: gate.userMessage, answer },
        json: true, timeout: 4000,
      });
    } catch (e) { /* storing is best effort; the answer still goes out */ }
  }
  return [{ json: { output: answer } }];
}

const p = res.proposal;
const path = String(p.url || '').replace('http://100.122.6.64:4010/api', '');

// Show the exact payload, not just the model's prose. Approving a sentence is
// not approving the request: a tender clearly marked Sudan once came through as
// country "EG" under a summary that read perfectly well.
const fields = Object.entries(p.body || {})
  .map(([k, v]) => '  - `' + k + '`: ' + (typeof v === 'object' ? JSON.stringify(v) : String(v)))
  .join('\n');

const lines = [
  out.trim(),
  '',
  '---',
  '⚠️ **لم يُنفَّذ أي شيء بعد.**',
  '',
  '**الإجراء المقترح:** ' + p.label,
  '**التفاصيل:** ' + (p.summary || '—'),
  '',
  '**ما سيُرسَل بالضبط** (`' + (p.method || 'POST') + ' ' + path + '`):',
  fields || '  (بدون حقول)',
  '',
  'راجع القيم أعلاه. للتنفيذ اكتب الرقم: **' + p.code + '**',
  'الاقتراح يسقط تلقائيًا بعد 10 دقائق، وأي اقتراح جديد يلغي هذا.',
];
return [{ json: { output: await screened.call(this, lines.join('\n'), true) } }];
"""

RESULT_JS = r"""
const gate = $('Approval Gate').first().json;
const res = $input.first().json;
const a = gate.action || {};

const flat = v => Array.isArray(v) ? v.join('، ')
  : (v && typeof v === 'object' ? JSON.stringify(v) : String(v));

// fullResponse gives { statusCode, body, headers }; neverError means a 4xx
// arrives here as ordinary output rather than an exception.
const status = res.statusCode || 0;
const body = res.body !== undefined ? res.body : res;

if (status >= 400) {
  let why = body && body.message ? flat(body.message) : 'سبب غير معروف';
  // Progressive data capture refuses a stage move until that stage's own fields
  // are filled; naming them is the difference between a dead end and a next step.
  if (body && body.missingFields) {
    why += '\n\n**حقول مطلوبة قبل هذه الخطوة:** ' + flat(body.missingFields)
         + '\n\nاطلب مني تعبئتها وسأجهّز لك اقتراحًا بها.';
  }
  return [{ json: { output: '⛔ **فشل التنفيذ** — ' + a.label + '\n\n' + why } }];
}

const ref = body && (body.code || body.id)
  ? ('\n**المرجع:** `' + (body.code || body.id) + '`') : '';

// A new opportunity starts at LEAD_INTAKE with no probability, so it adds to
// the open value while contributing nothing to the weighted pipeline. Rather
// than leave the forecast quietly wrong, hand back the id and ask for the two
// fields that fix it — the id in the message is what lets the next turn build
// the update without a second lookup.
let followUp = '';
if ((a.url || '').endsWith('/opportunities') && (a.method || 'POST') === 'POST') {
  const oid = body && body.id ? body.id : '';
  followUp = '\n\n⚠️ الفرصة الآن في **LEAD_INTAKE** بلا احتمال ولا تاريخ إغلاق '
           + 'متوقع، فهي تُضاف إلى القيمة المفتوحة لكنها **لا تدخل الـWeighted '
           + 'Pipeline** إطلاقًا.\n\n'
           + '**لإدخالها في التوقّع، ردّ بالقيمتين** — مثال: '
           + '«الاحتمال 40 والإغلاق 2026-12-15».\n'
           + (oid ? 'opportunityId للتحديث: `' + oid + '`' : '');
}
// Record what the conversation is now about, as a field rather than as a
// sentence in the answer. The line above still prints the id — it is useful to
// the reader — but the next turn no longer depends on the model finding it
// there, surviving the buffer, and being parsed back out of prose.
const oid = (body && body.id) ? body.id
  : ((a.url || '').match(/opportunities\/([0-9a-f-]{36})/) || [])[1];
if (oid) {
  try {
    await this.helpers.httpRequest({
      method: 'PUT',
      url: 'http://100.122.6.64:3025/context/' + encodeURIComponent(gate.sessionId),
      headers: { 'X-ACMS-Svc': '__SVC__' },
      body: {
        opportunityId: oid,
        opportunityCode: body && body.code ? body.code : undefined,
        opportunityName: body && body.name ? body.name : undefined,
        accountId: (a.body && a.body.accountId) || undefined,
      },
      json: true,
    });
  } catch (e) { /* context is an optimisation; never fail the execution for it */ }
}

return [{ json: { output:
  '✅ **تم التنفيذ** — ' + a.label + '\n\n' + (a.summary || '') + ref +
  '\n\nالتغيير مسجَّل في سجل التدقيق باسم حساب المساعد.' + followUp } }];
"""

add({
    "parameters": {"jsCode": js(GATE_JS)},
    "type": "n8n-nodes-base.code",
    "typeVersion": 2,
    "position": [-1120, 0],
    "id": "gate",
    "name": "Approval Gate",
})
wire("ACMS Login", "Approval Gate")

# Three ways out of the gate, not two. `reply` is the one added in phase 4: a
# greeting or a "what can you do" is answered from the gate itself and goes
# straight to the formatter, so it costs no model call on either the
# orchestrator or a specialist. The other two branches are unchanged.
add({
    "parameters": {
        "rules": {"values": [
            {"conditions": {
                "options": {"caseSensitive": True, "typeValidation": "loose",
                            "version": 2},
                "conditions": [{"id": "r1", "leftValue": "={{ $json.route }}",
                                "rightValue": "execute",
                                "operator": {"type": "string",
                                             "operation": "equals"}}],
                "combinator": "and"},
             "renameOutput": True, "outputKey": "execute"},
            {"conditions": {
                "options": {"caseSensitive": True, "typeValidation": "loose",
                            "version": 2},
                "conditions": [{"id": "r2", "leftValue": "={{ $json.route }}",
                                "rightValue": "reply",
                                "operator": {"type": "string",
                                             "operation": "equals"}}],
                "combinator": "and"},
             "renameOutput": True, "outputKey": "reply"},
        ]},
        "options": {"fallbackOutput": "extra", "renameFallbackOutput": "chat"},
    },
    "type": "n8n-nodes-base.switch",
    "typeVersion": 3.4,
    "position": [-900, 0],
    "id": "gate-if",
    "name": "Confirmed?",
})
wire("Approval Gate", "Confirmed?")

add({
    "parameters": {
        "method": "={{ $json.action.method }}",
        "url": "={{ $json.action.url }}",
        "sendHeaders": True,
        "headerParameters": {"parameters": [
            {"name": "Authorization", "value": "=Bearer {{ $json.accessToken }}"}]},
        "sendBody": True,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify($json.action.body) }}",
        # neverError + fullResponse keeps a 4xx as ordinary output carrying the
        # API's own body, instead of an Axios error whose message buries the
        # real reason inside three layers of escaped JSON.
        "options": {"response": {"response": {
            "fullResponse": True, "neverError": True, "responseFormat": "json"}}},
    },
    "type": "n8n-nodes-base.httpRequest",
    "typeVersion": 4.2,
    "position": [-700, -260],
    "id": "do-action",
    "name": "Execute Action",
})

add({
    "parameters": {"jsCode": js(RESULT_JS)},
    "type": "n8n-nodes-base.code",
    "typeVersion": 2,
    "position": [-460, -260],
    "id": "do-result",
    "name": "Execution Result",
})
wire("Execute Action", "Execution Result")

add({
    "parameters": {"jsCode": js(CAPTURE_JS)},
    "type": "n8n-nodes-base.code",
    "typeVersion": 2,
    "position": [700, 0],
    "id": "capture",
    "name": "Capture Proposal",
})
wire("ACMS Orchestrator", "Capture Proposal")

# IF output 0 is true (confirmed → execute), output 1 is false (normal chat).
# Output order matches the switch rules: execute, reply, then the fallback.
connections["Confirmed?"] = {"main": [
    [{"node": "Execute Action", "type": "main", "index": 0}],
    [{"node": "Capture Proposal", "type": "main", "index": 0}],
    [{"node": "Has Attachment?", "type": "main", "index": 0}],
]}


# ------------------------------------------------------ document intelligence
#
# An attached RFQ/BOQ skips the orchestrator: routing it would mean carrying the
# whole document through an extra model call for nothing. The file is extracted
# to text first, then one agent reads it.

add({
    "parameters": {
        "conditions": {
            "options": {"caseSensitive": True, "typeValidation": "loose", "version": 1},
            "conditions": [{
                "leftValue": "={{ $json.hasFile }}",
                "rightValue": "true",
                "operator": {"type": "boolean", "operation": "true", "singleValue": True},
            }],
            "combinator": "and",
        },
        "options": {},
    },
    "type": "n8n-nodes-base.if",
    "typeVersion": 2,
    "position": [-700, 0],
    "id": "has-file",
    "name": "Has Attachment?",
})

# One extract node per family: the node takes a single operation, and a BOQ is
# as likely to arrive as a spreadsheet as it is a PDF.
add({
    "parameters": {
        "rules": {"values": [
            {"conditions": {
                "options": {"caseSensitive": False, "typeValidation": "loose", "version": 2},
                "conditions": [{"id": "d1", "leftValue": "={{ $json.fileExt }}",
                                "rightValue": "pdf",
                                "operator": {"type": "string", "operation": "equals"}}],
                "combinator": "and"},
             "renameOutput": True, "outputKey": "pdf"},
            {"conditions": {
                "options": {"caseSensitive": False, "typeValidation": "loose", "version": 2},
                "conditions": [{"id": "d2", "leftValue": "={{ $json.fileExt }}",
                                "rightValue": "xlsx|xls|ods",
                                "operator": {"type": "string", "operation": "regex"}}],
                "combinator": "and"},
             "renameOutput": True, "outputKey": "sheet"},
            {"conditions": {
                "options": {"caseSensitive": False, "typeValidation": "loose", "version": 2},
                "conditions": [{"id": "d3", "leftValue": "={{ $json.fileExt }}",
                                "rightValue": "csv",
                                "operator": {"type": "string", "operation": "equals"}}],
                "combinator": "and"},
             "renameOutput": True, "outputKey": "csv"},
        ]},
        "options": {"fallbackOutput": "extra", "renameFallbackOutput": "text"},
    },
    "type": "n8n-nodes-base.switch",
    "typeVersion": 3.4,
    "position": [-460, -700],
    "id": "doc-route",
    "name": "Route By Type",
})

for node_id, name, operation, pos in (
    ("x-pdf", "Extract PDF", "pdf", [-220, -880]),
    ("x-sheet", "Extract Sheet", "xlsx", [-220, -740]),
    # CSV gets the table extractor, not the text one: a BOQ that arrives as one
    # blob of text has no rows to add up, and the model will invent the total.
    ("x-csv", "Extract CSV", "csv", [-220, -600]),
    ("x-text", "Extract Text", "text", [-220, -460]),
):
    add({
        "parameters": {
            "operation": operation,
            "binaryPropertyName": "={{ $('Approval Gate').first().json.binaryKey }}",
            "options": {},
        },
        "type": "n8n-nodes-base.extractFromFile",
        "typeVersion": 1.1,
        "position": pos,
        "id": node_id,
        "name": name,
    })
    wire(name, "Prepare Document")

connections["Route By Type"] = {"main": [
    [{"node": "Extract PDF", "type": "main", "index": 0}],
    [{"node": "Extract Sheet", "type": "main", "index": 0}],
    [{"node": "Extract CSV", "type": "main", "index": 0}],
    [{"node": "Extract Text", "type": "main", "index": 0}],
]}

PREPARE_DOC_JS = r"""
const gate = $('Approval Gate').first().json;
const chat = $('When chat message received').first().json;
const items = $input.all();

// A PDF or text extract lands in `text`; a spreadsheet arrives as one item per
// row, so rebuild those into a readable table instead of dumping raw JSON.
let text = '';
if (items.length === 1 && typeof items[0].json.text === 'string') {
  text = items[0].json.text;
} else {
  const rows = items.map(i => i.json).filter(Boolean);
  if (rows.length) {
    const cols = Object.keys(rows[0]);
    const line = r => cols.map(c => (r[c] === undefined || r[c] === null ? '' : String(r[c]))).join(' | ');
    text = cols.join(' | ') + '\n' + rows.map(line).join('\n');
  }
}

// Line totals and a grand total are computed here, not by the model. Asked to
// add up a BOQ it produced six correct line totals and a grand total 1,000 off
// — arithmetic is the one thing a spreadsheet path must never delegate.
let totals = '';
if (items.length > 1 && items[0].json && typeof items[0].json === 'object') {
  const rows = items.map(i => i.json).filter(Boolean);
  const cols = Object.keys(rows[0] || {});
  const find = re => cols.find(c => re.test(c.replace(/\s+/g, '').toLowerCase()));
  const qtyCol = find(/^(qty|quantity|كمية|الكمية)$/);
  const rateCol = find(/(unitrate|unitprice|rate|price|سعر|السعر)/);
  const descCol = find(/(desc|description|item|بند|الوصف)/) || cols[0];
  const num = v => {
    const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : null;
  };
  if (qtyCol && rateCol) {
    const lines = [];
    let grand = 0;
    let ok = true;
    for (const r of rows) {
      const q = num(r[qtyCol]);
      const u = num(r[rateCol]);
      if (q === null || u === null) { ok = false; continue; }
      const line = q * u;
      grand += line;
      lines.push('- ' + String(r[descCol]) + ': ' + q + ' × ' + u + ' = ' + line.toFixed(2));
    }
    if (lines.length) {
      totals = '\n\n--- إجماليات محسوبة آليًا (استخدمها كما هي) ---\n'
             + lines.join('\n')
             + '\nالمجموع الكلي: ' + grand.toFixed(2)
             + (ok ? '' : '\n(بعض الصفوف تعذّر قراءتها رقميًا وأُسقطت من المجموع)');
    }
  }
}

// Long tenders are common and the budget is finite; truncating loudly beats
// silently analysing the first third of a document. The figure is set by
// DOC_PROVIDER — Groq's per-minute ceiling is far below a whole tender.
const LIMIT = __DOC_LIMIT__;
let truncated = false;
if (text.length > LIMIT) {
  text = text.slice(0, LIMIT);
  truncated = true;
}

return [{
  json: {
    fileName: gate.fileName || 'document',
    documentText: text + totals,
    hasComputedTotals: totals !== '',
    truncated,
    // Bounded by the gate, same as the chat path — a document already fills
    // the budget on its own, so the covering note must not add to it unchecked.
    userMessage: String(gate.userMessage || '').trim(),
    accessToken: gate.accessToken,
  },
}];
""".replace("__DOC_LIMIT__", str(DOC_TEXT_LIMIT))

add({
    "parameters": {"jsCode": PREPARE_DOC_JS},
    "type": "n8n-nodes-base.code",
    "typeVersion": 2,
    "position": [60, -700],
    "id": "doc-prep",
    "name": "Prepare Document",
})

DOC_PROMPT = (
    "أنت وكيل ذكاء المستندات في منظومة أفرو التجارية (ACMS). يصلك نص مستخرج من "
    "كراسة شروط أو RFQ/RFP أو جدول كميات (BOQ).\n\n"
    "مهمتك:\n"
    "1. حدّد نوع المستند والجهة المصدِرة ورقم المناقصة إن وُجد.\n"
    "2. استخرج المواعيد الحاسمة: آخر موعد للتقديم، موعد الاستيضاحات، سريان العرض.\n"
    "3. استخرج المتطلبات الإلزامية (ضمان ابتدائي، سابقة أعمال، شهادات، شروط جزائية).\n"
    "4. لو فيه جدول كميات، لخّص البنود الرئيسية بكمياتها ووحداتها، واذكر عددها الكلي.\n"
    "5. اذكر صراحةً ما لم تجده بدل أن تفترضه.\n\n"
    "قواعد:\n"
    "- كل ما تذكره لازم يكون موجودًا في نص المستند. ممنوع الاستنتاج أو الإكمال.\n"
    "- لو النص مبتور (سيُقال لك ذلك) نبّه المستخدم أن التحليل يغطي الجزء المتاح فقط.\n"
    "- **ممنوع أن تحسب أي شيء بنفسك**: لا جمع ولا ضرب ولا استنتاج تواريخ من مدد. "
    "لو وصلك قسم \"إجماليات محسوبة آليًا\" فانقله كما هو. ولو لم يصلك، قل إن "
    "الإجمالي غير محسوب بدل أن تحسبه.\n"
    "- التواريخ اعرضها كما وردت حرفيًا. لا تحوّل \"120 يومًا\" إلى تاريخ.\n"
    "- المبالغ بعملتها كما وردت.\n\n"
    "لو طلب المستخدم تسجيل المستند كفرصة جديدة، ابحث أولًا عن الحساب المناسب بـ"
    "acms_list_accounts وتأكد أنه موجود، ثم أنهِ ردّك بعلامة:\n"
    "@@ACTION{\"action\":\"opportunity_create\",\"name\":\"...\",\"accountId\":\"UUID\","
    "\"country\":\"EG\",\"estimatedValue\":123,\"currency\":\"USD\","
    "\"summary\":\"وصف عربي قصير\"}@@\n"
    "ممنوع اختراع accountId — لو لم تجد الحساب اسأل المستخدم.\n"
    "**country خُذها من المستند نفسه** (SD للسودان، EG لمصر، MG لمدغشقر، KM لجزر "
    "القمر، KE لكينيا) ولا تضع قيمة افتراضية. ولو المستند لا يذكر قيمة تقديرية "
    "فاترك estimatedValue بدون قيمة بدل أن تضع صفرًا.\n"
    "وممنوع أن تقول إن شيئًا نُفِّذ؛ التنفيذ يحدث بعد أن يكتب المستخدم رقم التأكيد."
)

add({
    "parameters": {
        "promptType": "define",
        "text": ("=المستند: {{ $json.fileName }}"
                 "{{ $json.truncated ? ' (النص مبتور — يغطي الجزء الأول فقط)' : '' }}\n"
                 "طلب المستخدم: {{ $json.userMessage || 'لخّص المستند واستخرج المواعيد والمتطلبات' }}\n\n"
                 "--- نص المستند ---\n{{ $json.documentText }}"),
        "needsFallback": FALLBACK_DOC,
        "options": {"systemMessage": DOC_PROMPT},
    },
    **RETRY,
    "onError": "continueRegularOutput",
    "type": "@n8n/n8n-nodes-langchain.agent",
    "typeVersion": 3.1,
    "position": [340, -700],
    "id": "doc-agent",
    "name": "Document Agent",
})
wire("Prepare Document", "Document Agent")
wire("Document Agent", "Capture Proposal")

# All three document models are always written in; DOC_PROVIDER decides which
# one is enabled and the other two are left in place as standby. OpenAI is the
# production choice: gpt-4o takes a whole tender in one call and answers in
# seconds. Groq answers as fast but meters 8000 tokens/minute on the shared
# free tier — hence the much smaller text budget above. Ollama has no ceiling
# and keeps the client's tender on the server, at minutes per answer.
add({
    "parameters": {
        "model": {
            "mode": "list",
            "value": OPENAI_DOC_MODEL,
            "cachedResultName": OPENAI_DOC_MODEL,
        },
        "options": {"temperature": 0.1},
    },
    "type": "@n8n/n8n-nodes-langchain.lmChatOpenAi",
    # Same version as the other two. The document agent has no output parser, so
    # the response shape does not matter here — but two versions of one node in
    # one workflow is a difference the next reader has to explain to themselves,
    # and there is nothing to explain.
    "typeVersion": OPENAI_NODE_VERSION,
    "position": [780, -540],
    "id": "doc-openai",
    "name": "OpenAI — المستندات",
    "disabled": DOC_PROVIDER != "openai",
    "notes": "الإنتاج. نافذة سياق واسعة تستوعب كراسة الشروط في نداء واحد، "
             "والردّ بالثواني.",
    "credentials": OPENAI_CRED,
})
wire("OpenAI — المستندات", "Document Agent", "ai_languageModel")

add({
    "parameters": {"model": GROQ_SPEC_MODEL, "options": {"temperature": 0.1}},
    "type": "@n8n/n8n-nodes-langchain.lmChatGroq",
    "typeVersion": 1,
    "position": [560, -540],
    "id": "doc-groq",
    "name": "Groq — المستندات",
    "disabled": DOC_PROVIDER != "groq",
    "notes": "سريع (ثوانٍ). القيد: 8000 توكن/دقيقة للحساب المشترك، فالنص المستخرج "
             "يُقصّ عند %d حرف — المستندات الطويلة تُحلَّل جزئيًا ويُنبَّه المستخدم."
             % DOC_TEXT_LIMIT,
    "credentials": GROQ_CRED,
})
wire("Groq — المستندات", "Document Agent", "ai_languageModel")

add({
    "parameters": {
        "model": OLLAMA_MODEL,
        "options": {"numCtx": 32768, "temperature": 0.1, "keepAlive": "60m"},
    },
    "type": "@n8n/n8n-nodes-langchain.lmChatOllama",
    "typeVersion": 1,
    "position": [340, -540],
    "id": "doc-model",
    "name": "Ollama — المستندات",
    # Also enabled when it is only the fallback: the agent's fallback input is
    # declared required, so a disabled node there leaves it unsatisfied. And of
    # everything here, a whole tender is the call most likely to need it.
    "disabled": DOC_PROVIDER != "ollama" and not FALLBACK_DOC,
    "notes": "محلي: بلا حدود على حجم المستند، وكراسة العميل لا تخرج من السيرفر. "
             "أبطأ بكثير (70–255 ثانية).",
    "credentials": OLLAMA_CRED,
})
wire("Ollama — المستندات", "Document Agent", "ai_languageModel",
     index=1 if FALLBACK_DOC else 0)

connections["Has Attachment?"] = {"main": [
    [{"node": "Route By Type", "type": "main", "index": 0}],
    [{"node": "ACMS Orchestrator", "type": "main", "index": 0}],
]}

add({
    "parameters": {"contextWindowLength": 3},
    "type": "@n8n/n8n-nodes-langchain.memoryBufferWindow",
    "typeVersion": 1.4,
    "position": [-620, 200],
    "id": "orch-memory",
    "name": "Simple Memory",
})
wire("Simple Memory", "ACMS Orchestrator", "ai_memory")


GROQ_NOTE = ("سحابي وسريع (ثوانٍ بدل دقائق). حساب Groq المشترك على الخطة المجانية "
             "محدود بـ8000 توكن/دقيقة لكل موديل، ويشاركه باقي workflows الشركة.")
OLLAMA_NOTE = ("محلي على السيرفر: بلا حدود والبيانات لا تخرج من الشبكة، لكنه أبطأ "
               "بكثير (CPU فقط).")


OPENAI_NOTE = ("الإنتاج. المزوّد النشط والوحيد في المسار التشغيلي.")


def model_set(prefix, label, groq_model, openai_model,
              pos_openai, pos_groq, pos_ollama, num_ctx, routed=False):
    """Three model nodes for one consumer; PROVIDER enables exactly one.

    The two that lose stay in the workflow with disabled=True — they are the
    documented standby path, and deleting them would make re-enabling either
    one a rebuild instead of a constant change.
    """
    # A routed node reads the model name the gate already decided. `mode: id`
    # rather than `list` because the value is an expression, not a picked entry,
    # and the literal default is repeated inside the expression so a gate that
    # somehow returns nothing still names a real model instead of an empty one.
    if routed:
        model_param = {
            "mode": "id",
            "value": "={{ $('Approval Gate').first().json.specModel || '%s' }}"
                     % openai_model,
        }
        note = (OPENAI_NOTE + " النموذج يُختار لكل سؤال في «Approval Gate» "
                "حسب النية: %s، وما عداها %s."
                % ("، ".join("%s ← %s" % (k, v)
                             for k, v in sorted(SPEC_MODEL_ROUTES.items())),
                   openai_model))
    else:
        model_param = {
            "mode": "list",
            "value": openai_model,
            "cachedResultName": openai_model,
        }
        note = OPENAI_NOTE

    openai = add({
        "parameters": {
            "model": model_param,
            "options": {"temperature": 0.1},
        },
        "type": "@n8n/n8n-nodes-langchain.lmChatOpenAi",
        "typeVersion": OPENAI_NODE_VERSION,
        "position": pos_openai,
        "id": prefix + "-openai",
        "name": f"OpenAI — {label}",
        "disabled": PROVIDER != "openai",
        "notes": note,
        "credentials": OPENAI_CRED,
    })
    groq = add({
        "parameters": {"model": groq_model, "options": {"temperature": 0.1}},
        "type": "@n8n/n8n-nodes-langchain.lmChatGroq",
        "typeVersion": 1,
        "position": pos_groq,
        "id": prefix + "-groq",
        "name": f"Groq — {label}",
        "disabled": PROVIDER != "groq",
        "notes": GROQ_NOTE,
        "credentials": GROQ_CRED,
    })
    ollama = add({
        "parameters": {
            "model": OLLAMA_MODEL,
            "options": {"numCtx": num_ctx, "temperature": 0.1, "keepAlive": "60m"},
        },
        "type": "@n8n/n8n-nodes-langchain.lmChatOllama",
        "typeVersion": 1,
        "position": pos_ollama,
        "id": prefix + "-ollama",
        "name": f"Ollama — {label}",
        "disabled": PROVIDER != "ollama" and not FALLBACK_CHAT,
        "notes": OLLAMA_NOTE,
        "credentials": OLLAMA_CRED,
    })
    return openai, groq, ollama


orch_openai, orch_groq, orch_ollama = model_set(
    "orch", "المنسّق", GROQ_ORCH_MODEL, OPENAI_ORCH_MODEL,
    [-760, 60], [-760, 200], [-760, 340], 8192)
wire(orch_openai, "ACMS Orchestrator", "ai_languageModel")
wire(orch_groq, "ACMS Orchestrator", "ai_languageModel")
wire(orch_ollama, "ACMS Orchestrator", "ai_languageModel",
     index=1 if FALLBACK_CHAT else 0)

# ------------------------------------------------------------ knowledge layer
#
# ACMS answers what the system *records*; the knowledge index answers what the
# company has *written down*. They are separate sources and the boundary is
# enforced in three places, because a rule in one place is a rule the model can
# talk its way past: this tool's description says what it is not for, the
# orchestrator's prompt repeats it, and the regression suite has a counter-test
# that fails if an operational question is ever answered from a document.
if RAG:
    add({
        "parameters": {"model": EMBED_MODEL, "options": {}},
        "type": "@n8n/n8n-nodes-langchain.embeddingsOpenAi",
        "typeVersion": 1.2,
        "position": [1560, 700],
        "id": "rag-embed",
        "name": "Embeddings — المعرفة",
        "credentials": OPENAI_CRED,
        "notes": "لا بد أن يطابق نموذج التضمين المستخدم في الاستيعاب، "
                 "وإلا فالبحث في فضاء مختلف عن الفهرس.",
    })
    add({
        "parameters": {
            "mode": "retrieve-as-tool",
            "toolDescription":
                "ابحث في وثائق الشركة المكتوبة: السياسات وإجراءات التشغيل "
                "والقوالب والأدلة الفنية. استخدمها للأسئلة عن *ما هو مكتوب* — "
                "«إيه سياسة كذا؟»، «إيه خطوات كذا؟». "
                "**لا تستخدمها لأي سؤال عن بيانات النظام** — الفرص والحسابات "
                "والأنشطة والتكلفة والهوامش والمؤشرات وحالة أي سجل تأتي من "
                "أدوات ACMS وحدها، ولو ذُكرت في وثيقة فالوثيقة قديمة.",
            "qdrantCollection": {"__rl": True, "mode": "id",
                                 "value": RAG_COLLECTION},
            "topK": 5,
            "options": {
                # A fixed expression, never $fromAI. The model chooses the
                # query; it does not get to choose what it is allowed to see.
                "searchFilterJson":
                    "={{ JSON.stringify({ must: [ { key: 'metadata.classification',"
                    " match: { any: $('Approval Gate').first().json.ragClasses } } ] }) }}",
            },
        },
        "type": "@n8n/n8n-nodes-langchain.vectorStoreQdrant",
        "typeVersion": 1.3,
        "position": [1560, 560],
        "id": "rag-tool",
        "name": "acms_knowledge_search",
        "credentials": QDRANT_CRED,
        "onError": "continueRegularOutput",
    })
    wire("Embeddings — المعرفة", "acms_knowledge_search", "ai_embedding")
    wire("acms_knowledge_search", "ACMS Orchestrator", "ai_tool")


spec_openai, spec_groq, spec_ollama = model_set(
    "spec", "المتخصصون", GROQ_SPEC_MODEL, OPENAI_SPEC_MODEL,
    [1120, 280], [1120, 420], [1120, 560], 16384, routed=True)


# ----------------------------------------------------------- shared tool node

# Same call signature as before — only the payload shrinks.
#
# The first attempt here also exposed stage/country/view as filters. That
# backfired: `$fromAI` marks every declared parameter as *required* in the tool
# schema, so the moment the model left one out Groq refused the whole call with
# "did not match schema: missing properties: 'stage', 'country'" and the agent
# gave up without ever reading the tool. The extra filters exist on /q and can
# be reached with an explicit query later; they are not worth a required
# property each. `status` alone is the shape that was already proven to work.
opportunities = q_tool(
    "t-opps", "acms_list_opportunities",
    "الفرص التجارية حسب الحالة. مرّر status واحدة من: ACTIVE (المفتوحة) أو LOST "
    "(المخسورة) أو CLOSED (المكسوبة/المنتهية) أو CANCELLED أو ON_HOLD. "
    "الرد مختصر: كود واسم ومرحلة وحالة وقيمة وعملة وتاريخ إغلاق واسم الحساب، "
    "ومعه total وtruncated — إن كانت truncated صحيحة فما عرضته جزء لا الكل. "
    "المراحل الممكنة داخل النتيجة: " + STAGES + ".",
    "opportunities", [-600, 1080],
    query=[("status", "=" + from_ai(
        "status", "احدى القيم ACTIVE او LOST او CLOSED او CANCELLED او ON_HOLD"))])

# Resolving a name to an id via the full list would ship the whole pipeline into
# the prompt; this returns just the matches.
find_opportunity = http_tool(
    "t-find", "acms_find_opportunity",
    "ابحث عن فرصة بالاسم أو الكود واحصل على معرّفها (id) وبياناتها. استخدمها دائمًا "
    "قبل أي أداة تطلب معرّف فرصة. مرّر جزءًا من الاسم مثل FTTH أو Backbone.",
    "/opportunities", [-260, 1080],
    query=[("search", "=" + from_ai("search", "جزء من اسم الفرصة او كودها"))])

# Shared by the compliance agent (to report) and the action agent (to resolve an
# approval id before proposing a decision on it).
approvals_queue = http_tool(
    "t-appr", "acms_approvals_queue",
    "طلبات الموافقة المعلّقة (خصومات، نسخ تكلفة، عروض) بمعرّفاتها.",
    "/approvals/my-queue", [420, 1080])

accounts = q_tool(
    "t-acc", "acms_list_accounts",
    "قائمة الحسابات/العملاء بأكوادها وبلدها ونوعها وحالتها الائتمانية ومعرّفاتها.",
    "accounts", [80, 1080])

master_data = http_tool(
    "t-md", "acms_master_data",
    "القيم المرجعية المسموحة في النظام (المراحل، الحالات، الأدوار، الصناعات، "
    "أنواع الشركاء، الدول، العملات). الرد كبير — لا تستدعها إلا عند الشك في قيمة.",
    "/master-data", [760, 1080])


# --------------------------------------------------------------- specialists

# ------------------------------------------------------- structured specialist output
#
# §11: a specialist should hand back fields, not prose to be re-parsed. `answer`
# stays the human sentence so the orchestrator has something to relay, and
# `evidence` is required because an unsupported claim is the failure this whole
# layer exists to catch — a session once received correct computed facts and the
# model answered against them.
#
# autoFix is on deliberately: a local model drifts out of schema more often than
# a hosted one, and one repair round is cheaper than losing the turn.
# `evidence` is deliberately absent, and its absence is the whole point of this
# version. The first attempt required it, and a required field with no valid
# value does not produce grounding — it produces something shaped like it. Asked
# to create an opportunity for an account that does not exist, the model filled
# the field with ACC-2026-000007, which is Vodafone. On a correctly grounded
# answer the same field came back *empty*, and the orchestrator dutifully
# announced that a correct answer had no support. Unreliable in both directions.
#
# The system already knows what it served: the evidence ledger records every /q
# response against the session — endpoints, record codes, truncation and the
# computed facts block. So the sources are attached from the ledger after the
# answer is produced. The model cannot cite what it was not given because it no
# longer does the citing.
SPECIALIST_SCHEMA = json.dumps({
    "type": "object",
    "properties": {
        "answer": {"type": "string",
                   "description": "الإجابة العربية كما تُعرض للمستخدم"},
        "risks": {"type": "array", "items": {"type": "string"},
                  "description": "مخاطر مستنتجة من البيانات، إن وُجدت"},
        "recommendations": {"type": "array", "items": {"type": "string"}},
        "limitations": {"type": "array", "items": {"type": "string"},
                        "description": "ما لم تستطع الإجابة عنه ولماذا"},
        "action_required": {"type": "boolean"},
    },
    "required": ["answer"],
}, ensure_ascii=False)

if STRUCTURED:
    add({
        "parameters": {
            "schemaType": "manual",
            "inputSchema": SPECIALIST_SCHEMA,
            "autoFix": True,
        },
        "type": "@n8n/n8n-nodes-langchain.outputParserStructured",
        "typeVersion": 1.3,
        "position": [420, 200],
        "id": "spec-parser",
        "name": "Specialist Output",
        "notes": "مخطط موحّد لردود المتخصصين — answer وevidence إلزاميان.",
    })
    # autoFix means "if the JSON does not parse, ask a model to repair it", so
    # the parser has its own required ai_languageModel input. Leaving it empty
    # fails the whole specialist call with "A Model sub-node must be connected
    # and enabled" — which surfaces to the user as a generic agent error, not as
    # a parsing problem. Repairing malformed JSON is a small job, so it gets the
    # orchestrator's cheaper model rather than the specialists' one. All three
    # are wired and the disabled two are ignored, exactly as everywhere else.
    wire(orch_openai, "Specialist Output", "ai_languageModel")
    wire(orch_groq, "Specialist Output", "ai_languageModel")
    wire(orch_ollama, "Specialist Output", "ai_languageModel")


def specialist(node_id, tool_name, title, description, role, x, tools,
               agent_rules=None):
    add({
        "parameters": {
            "toolDescription": description,
            "text": "={{ $fromAI('query', 'نص السؤال كجملة واحدة', 'string') }}",
            "hasOutputParser": STRUCTURED,
            "needsFallback": FALLBACK_CHAT,
            "options": {"systemMessage": role + "\n\n" + (agent_rules or READ_RULES)},
        },
        **RETRY,
        "type": "@n8n/n8n-nodes-langchain.agentTool",
        "typeVersion": 3,
        "position": [x, 420],
        "id": node_id,
        "name": tool_name,
        "notes": title,
    })
    wire(tool_name, "ACMS Orchestrator", "ai_tool")
    if STRUCTURED:
        wire("Specialist Output", tool_name, "ai_outputParser")
    wire(spec_openai, tool_name, "ai_languageModel")
    wire(spec_groq, tool_name, "ai_languageModel")
    wire(spec_ollama, tool_name, "ai_languageModel",
         index=1 if FALLBACK_CHAT else 0)
    for t in tools:
        wire(t, tool_name, "ai_tool")


# One column per specialist; its private tools sit in the same column below.
col = {"sales": -600, "fin": -260, "exec": 80, "gov": 420, "act": 760, "rep": 1100}

REPORT_ROLE = (
    "أنت وكيل التقارير في منظومة أفرو التجارية (ACMS). تولّد ملفات جاهزة للإرسال "
    "عبر أداة acms_generate_report، ثم تعطي المستخدم رابط التحميل.\n\n"
    "التقارير المتاحة:\n"
    "- exec_summary: ملخّص تنفيذي — مؤشرات الأداء، الـpipeline حسب المرحلة، الفرص "
    "المفتوحة، مواعيد المناقصات، والمكسوب والمخسور. لا يحتاج معرّف فرصة.\n"
    "- cost_sheet: ورقة تكلفة لفرصة واحدة — الحزم والبنود وإجمالي البيع والتكلفة "
    "والهامش. يحتاج opportunityId، فابحث عنه أولًا بـacms_find_opportunity.\n\n"
    "الصيغ: pdf للقراءة والطباعة، pptx للعرض على الإدارة.\n\n"
    "**كل الأرقام تُحسب داخل خدمة التقارير من بيانات النظام — لا تحسب شيئًا ولا "
    "تكتب رقمًا في التعليق.** حقل narrative مخصّص لتعليق تنفيذي قصير (سطران أو "
    "ثلاثة) عن الاتجاه والمخاطر والخطوة التالية، بلا أرقام.\n\n"
    "بعد التوليد تُرجع الأداة رابطًا وحقل facts فيه الأرقام الحقيقية — اعرض الرابط "
    "ثم لخّص facts كما جاءت حرفيًا. لو رجع خطأ فاذكره كما هو ولا تدّعِ أن الملف جاهز."
)

ACTION_ROLE = (
    "أنت وكيل التنفيذ في منظومة أفرو التجارية (ACMS). أنت **لا تنفّذ شيئًا بنفسك** — "
    "أدواتك كلها قراءة فقط. دورك أن تجهّز اقتراح إجراء دقيقًا ينتظر تأكيد المستخدم.\n\n"
    "الخطوات:\n"
    "1. حدّد الإجراء المطلوب واجمع معرّفاته الحقيقية بأدوات القراءة "
    "(acms_find_opportunity للفرص، acms_list_accounts للحسابات، "
    "acms_approvals_queue للموافقات). ممنوع اختراع أي معرّف.\n"
    "   كل القيم المسموحة مذكورة أدناه — لا تستدعِ أداة للبحث عنها.\n"
    # A well-formed uuid used to be enough. It is not: asked to create an
    # opportunity for an account that does not exist, the agent sent a real
    # account's id belonging to a different company. The service now resolves
    # every id and compares it with the name stated here, so the name is not
    # decoration — it is the half of the pair that makes the check possible.
    "   **لو لم تجد الحساب أو الفرصة المطلوبة بالاسم الذي ذكره المستخدم، فقل ذلك "
    "صراحةً ولا تستبدل بها سجلًا آخر قريبًا.** النظام يتحقّق من أن كل معرّف "
    "ترسله يخصّ فعلًا الاسم الذي تذكره، ويرفض الاقتراح إن اختلفا.\n"
    "2. لو نقص شيء أو كان الطلب غامضًا، اسأل ولا تقترح.\n"
    # Phase 7 replaced this paragraph's job. It used to tell the agent to hunt
    # for an "opportunityId للتحديث" line in the transcript, because that was the
    # only way the previous turn's opportunity survived. That id now arrives as a
    # stored field in the session context, injected ahead of the question, so the
    # instruction had become a description of a mechanism that no longer runs.
    "   لو وصلك سطر «السياق الجاري» فيه opportunityId فاستخدمه مباشرة لأي متابعة "
    "على نفس الفرصة، ولا تبحث عنها من جديد ولا تسأل عن اسمها.\n"
    "3. لو كان كل شيء واضحًا، **استدعِ أداة acms_propose_action** — هي الطريقة "
    "الوحيدة لتسجيل اقتراح. مرّر:\n"
    "   action: اسم الإجراء من القائمة أدناه.\n"
    "   params: كائن JSON بحقول الإجراء فقط، مثل "
    "{\"accountId\":\"a3d5…\",\"fullName\":\"Mohamed Salah\",\"jobTitle\":\"PM\"}\n"
    "   summary: وصف عربي قصير لما سيحدث.\n"
    "   ثم اكتب للمستخدم سطرًا واحدًا بصيغة المستقبل يصف ما سيحدث، ولا تذكر رقم "
    "تأكيد — النظام يضيفه بنفسه بعد ردّك.\n"
    "   لو ردّت الأداة بـok=false فاعرض رسالة الخطأ كما هي ولا تدّعِ أن شيئًا تم.\n\n"
    "الإجراءات المسموح بها وحقولها:\n"
    "- stage: opportunityId, toStage, reason — نقل الفرصة لمرحلة أخرى. لو رفض النظام "
    "بسبب حقول ناقصة (Progressive Data Capture) اقترح update أولًا لتعبئتها.\n"
    "- update: opportunityId, fields {scopeSummary, solutionStrategy, nextStep, "
    "estimatedValue, proposedPrice, probability, forecastCategory, health, "
    "expectedCloseDate} — تحديث بيانات الفرصة.\n"
    "- status: opportunityId, status (ACTIVE/ON_HOLD/CANCELLED/LOST/CLOSED), "
    "exitReason (NO_BID/LOST/CANCELLED/ON_HOLD/DISQUALIFIED مطلوب لغير CLOSED), exitNotes.\n"
    "- activity: type (CALL/MEETING/EMAIL/SITE_VISIT/NOTE/TASK), subject, "
    "opportunityId أو accountId, dueAt (ISO), body, completed.\n"
    "- opportunity_create: name, accountId (من acms_list_accounts), accountName, "
    "country (رمز حرفين) — المطلوب فقط. وإن ذُكرت: industry, source, currency, "
    "estimatedValue, nextStep. **لا تسأل عن الاختيارية؛ اقترح بما لديك واذكر ما "
    "تركته فارغًا.**\n"
    "  source من: TENDER_PORTAL, DIRECT_INVITATION, REFERRAL, EXISTING_CLIENT, "
    "MARKETING, PARTNER, OTHER.\n"
    "  estimatedValue لا تضع فيها صفرًا إن كانت القيمة غير معروفة — اتركها.\n"
    "- account_create: legalName, type, country (رمز حرفين) — وإن ذُكرت: tradeName, "
    "industry, city, address, website, taxId, creditStatus, paymentTermDays.\n"
    "  type من: OPERATOR, CONTRACTOR, GOVERNMENT, ENTERPRISE, DEVELOPER, VENDOR.\n"
    "  industry من: FTTH, FTTS, WIRELESS, FIXED, SUBMARINE, MEP, ELV, CORE_NETWORK, "
    "IT, SUPPLY.\n"
    "  creditStatus من: GOOD, WATCH, HOLD, BLOCKED.\n"
    "  **الحساب لا يحمل عملة** — العملة على مستوى الفرصة. لو ذكر المستخدم عملة "
    "فوضّح ذلك ولا تدرجها.\n"
    "  قبل الاقتراح ابحث في acms_list_accounts للتأكد أن العميل غير مسجَّل بالفعل، "
    "وإن وجدته فاعرضه بدل إنشاء نسخة مكررة.\n"
    "- contact_create: accountId (UUID من acms_list_accounts)، accountName، "
    "fullName — وإن ذُكرت: jobTitle, email, phone, mobile, influence, isPrimary, "
    "notes, roles.\n"
    "  influence من: HIGH, MEDIUM, LOW, UNKNOWN.\n"
    "  roles مصفوفة من: DECISION_MAKER, TECHNICAL_EVALUATOR, COMMERCIAL_EVALUATOR, "
    "PROCUREMENT, FINANCE, END_USER, GATEKEEPER, CHAMPION, BLOCKER.\n"
    "  ابحث عن الحساب أولًا بـacms_list_accounts؛ لو لم تجده فاقترح account_create "
    "قبله ولا تخترع معرّفًا.\n"
    "- approval_decide: approvalId, decision, note.\n"
    # Caught by the phase-5 regression run: asked to approve, the agent replied
    # "لا يمكنني تنفيذ أي عملية موافقة" — reading an empty queue as a missing
    # permission. It has the permission; my-queue was simply empty, because the
    # one open approval belongs to another user. Saying so is the honest answer,
    # and claiming incapability hides a real fact about the data.
    "  لو رجعت acms_approvals_queue فارغة فهذا يعني **لا يوجد طلب في قائمتك**، "
    "وليس أنك غير مخوَّل. قل ذلك صراحة — وممنوع أن تقول إنك لا تستطيع الاعتماد "
    "أو إنك بلا صلاحية.\n"
    "- discount_decide: discountId, approve (true/false), note.\n\n"
    "المراحل المسموحة: " + STAGES + ".\n\n"
    "**ممنوع منعًا باتًا** أن تقول \"تم\" أو \"نُفِّذ\" أو \"حدّثت\" أو \"أنشأت\" — لم "
    "يحدث شيء بعد. ولا تذكر رقم تأكيد ولا تخترعه.\n\n"
    "مثال كامل: للطلب «أضف حساب Etisalat في مصر، مشغّل، لاسلكي» تستدعي:\n"
    "  action = account_create\n"
    "  params = {\"legalName\":\"Etisalat\",\"type\":\"OPERATOR\",\"country\":\"EG\","
    "\"industry\":\"WIRELESS\"}\n"
    "  summary = إنشاء حساب Etisalat\n"
    "ثم تكتب: «سيتم إنشاء حساب باسم Etisalat في مصر، نوع OPERATOR وصناعة WIRELESS.»\n\n"
    "إن لم تستدعِ الأداة فلم تطلب شيئًا — فلا تصف الإجراء وكأنه حدث."
)

specialist(
    "ag-sales", "sales_intelligence", "1 · ذكاء المبيعات",
    "وكيل ذكاء المبيعات: الفرص التجارية ومراحلها وصحتها وقيمها، الحسابات والعملاء، "
    "الأنشطة وآخر تواصل، ومواعيد إغلاق المناقصات القريبة. استخدمه لأي سؤال عن "
    "pipeline أو فرصة أو عميل أو موعد مناقصة.",
    "أنت وكيل ذكاء المبيعات في منظومة أفرو التجارية (ACMS). تخصصك: الفرص التجارية "
    "وصحتها ومراحلها، الحسابات والعملاء، الأنشطة والتواصل، ومواعيد إغلاق المناقصات. "
    "أجب عن سؤال المنسّق باختصار وبجدول عند الحاجة.",
    col["sales"],
    [
        opportunities,
        find_opportunity,
        http_tool("t-opp1", "acms_get_opportunity",
                  "تفاصيل فرصة واحدة بالـUUID: الوصف والاستراتيجية والتواريخ والمالك "
                  "والحساب. خُذ الـid من acms_list_opportunities (الحقل id وليس code).",
                  "/opportunities/" + from_ai("id", "معرف الفرصة UUID"),
                  [-600, 620]),
        accounts,
        q_tool("t-act", "acms_list_activities",
               "الأنشطة المسجّلة (مكالمات، اجتماعات، مهام) على الفرص والحسابات — "
               "لأسئلة آخر تواصل مع عميل أو المهام المتأخرة. لكل نشاط نوعه وموضوعه "
               "وموعده وتاريخ إنجازه واسم الفرصة والحساب.",
               "activities", [-600, 760]),
        http_tool("t-dl", "acms_bid_deadlines",
                  "المناقصات التي يقترب موعد إغلاقها خلال عدد أيام معيّن (بين 1 و180).",
                  "/bids/deadlines", [-600, 900],
                  query=[("days", "=" + from_ai("days", "عدد الايام من 1 الى 180", "number"))]),
    ])

specialist(
    "ag-fin", "financial_intelligence", "2 · الذكاء المالي",
    "وكيل الذكاء المالي: مراجعة التكلفة، تحليل الهامش، التحقق من التسعير، ومقارنة "
    "عروض الموردين والمقاولين من الباطن. استخدمه لأي سؤال عن تكلفة أو ربحية أو سعر "
    "أو مورّد.",
    "أنت وكيل الذكاء المالي في منظومة أفرو التجارية (ACMS). تخصصك: التكلفة والتسعير "
    "والهوامش ومقارنة عروض الموردين. لو احتجت معرّف فرصة، ابحث عنها أولًا بـ"
    "acms_list_opportunities ثم استخدم الـid. وضّح دائمًا أن الهامش محسوب على سعر البيع.",
    col["fin"],
    [
        find_opportunity,
        http_tool("t-cost", "acms_opportunity_costing",
                  "سيناريوهات التكلفة والتسعير لفرصة: الحزم والبنود والتكاليف والهامش.",
                  "/opportunities/" + from_ai("opportunityId", "معرف الفرصة UUID")
                  + "/costing", [-260, 620]),
        http_tool("t-quot", "acms_quotation_comparison",
                  "مقارنة عروض الموردين والمقاولين من الباطن لفرصة معيّنة، فنيًا وتجاريًا.",
                  "/opportunities/" + from_ai("opportunityId", "معرف الفرصة UUID")
                  + "/quotation-comparison", [-260, 760]),
    ])

specialist(
    "ag-exec", "executive_reporting", "3 · التقارير التنفيذية",
    "وكيل التقارير التنفيذية: مؤشرات الأداء (Weighted Pipeline، Win Rate، Forecast "
    "Accuracy، Gross Margin، الموافقات المفتوحة وزمن انتظارها) وملخصات الإدارة العليا "
    "وشرح معنى أي مؤشر. استخدمه لأي سؤال عن الحالة العامة أو ملخص للـCEO أو معنى مؤشر.",
    "أنت وكيل التقارير التنفيذية في منظومة أفرو التجارية (ACMS). تخصصك: مؤشرات "
    "الأداء وملخصات الإدارة العليا. عند عرض أي مؤشر اذكر قيمته ثم طريقة حسابه "
    "باختصار. لو المؤشر رجع unavailableReason فاشرح السبب بدل أن تقول \"صفر\".",
    col["exec"],
    [
        find_opportunity,
        opportunities,
        http_tool("t-met", "acms_dashboard_metrics",
                  "مؤشرات الأداء الحالية: WEIGHTED_PIPELINE, WIN_RATE, "
                  "FORECAST_ACCURACY, OPEN_APPROVALS, APPROVAL_WAIT, GROSS_MARGIN — "
                  "بقيمتها ووحدتها وعدد السجلات (basis) وسبب عدم التوفر إن وُجد.",
                  "/metrics/dashboard", [80, 620]),
        http_tool("t-met1", "acms_metric_explain",
                  "شرح مؤشر واحد: طريقة حسابه والقرار الذي يخدمه وكيف يمكن التلاعب "
                  "فيه. استخدمها فقط عند السؤال عن معنى مؤشر أو تفسير قيمته.",
                  "/metrics/" + from_ai("code", "كود المؤشر بحروف كبيرة"), [80, 760]),
    ])

specialist(
    "ag-gov", "compliance_and_approval", "4 · الالتزام والموافقات",
    "وكيل الالتزام والموافقات: ما ينتظر موافقة، سجل التدقيق (من غيّر ماذا ومتى)، "
    "قواعد فصل المهام، والقيم المرجعية المسموحة في النظام. استخدمه لأسئلة الموافقات "
    "والحوكمة والتدقيق وأسماء القيم المسموحة.",
    "أنت وكيل الالتزام والموافقات في منظومة أفرو التجارية (ACMS). تخصصك: طلبات "
    "الموافقة المعلّقة، سجل التدقيق، قواعد فصل المهام، والقيم المرجعية المسموحة.",
    col["gov"],
    [
        approvals_queue,
        http_tool("t-aud", "acms_audit_trail",
                  "سجل التدقيق لأي سجل: من غيّر ماذا ومتى.",
                  "/audit/" + from_ai("entityType", "نوع السجل مثل Opportunity او Account")
                  + "/" + from_ai("entityId", "معرف السجل UUID"), [420, 620]),
        http_tool("t-sod", "acms_sod_rules",
                  "قواعد فصل المهام (Segregation of Duties) — من الممنوع عليه اعتماد "
                  "ما أعدّه بنفسه.",
                  "/governance/sod-rules", [420, 760]),
        master_data,
    ],
    # لا أدوات مالية، ولا أداة تُعيد facts — فلا سبب لحمل قاعدتيهما.
    agent_rules=rules(RULE_EVIDENCE, RULE_SHAPE, RULE_READONLY, RULE_ERRORS))


specialist(
    "ag-act", "action_agent", "5 · التنفيذ والتكامل",
    "وكيل التنفيذ: أي طلب تغيير في النظام — نقل فرصة لمرحلة أخرى، تغيير حالتها "
    "(مكسوبة/مخسورة/معلّقة)، تسجيل نشاط أو مهمة، البتّ في طلب موافقة أو خصم. "
    "يُرجع اقتراحًا ينتظر تأكيد المستخدم ولا ينفّذ شيئًا بنفسه.",
    ACTION_ROLE,
    col["act"],
    [
        find_opportunity,
        accounts,
        approvals_queue,
        propose_tool("t-prop", "acms_propose_action",
                     "سجّل اقتراح إجراء ينتظر تأكيد المستخدم. هذه هي الطريقة "
                     "الوحيدة لتسجيل أي تغيير. تُعيد ok=true مع رقم التأكيد، أو "
                     "ok=false مع سبب الرفض. لا تنفّذ شيئًا بنفسها.",
                     [256, 620]),
        # Deliberately no acms_master_data: it returns the whole reference
        # catalogue in one response, which on its own pushed a request to 4,753
        # tokens and blew Groq's per-minute budget mid-conversation. Every enum
        # this agent needs is listed in its prompt instead, at a fraction of the
        # cost and with no round trip.
    ],
    # Its tools are read-only, but the agent is not "in read-only mode" — its
    # whole purpose is to propose a change. The blanket rule contradicted the
    # role it sits directly beneath.
    agent_rules=rules(RULE_EVIDENCE, RULE_SHAPE, RULE_ERRORS, RULE_FACTS))


specialist(
    "ag-rep", "report_agent", "6 · التقارير المولَّدة",
    "وكيل التقارير: يولّد ملفًا جاهزًا — ملخّص تنفيذي أو ورقة تكلفة — بصيغة PDF أو "
    "PowerPoint، ويعيد رابط تحميله. استخدمه لأي طلب فيه \"تقرير\" أو \"ملف\" أو "
    "\"عرض تقديمي\" أو \"صدّر\" أو \"ابعتلي\".",
    REPORT_ROLE,
    col["rep"],
    [
        find_opportunity,
        report_tool("t-rep", "acms_generate_report",
                    "يولّد ملف تقرير من بيانات ACMS الحيّة ويعيد رابط تحميله مع حقل "
                    "facts فيه الأرقام المحسوبة. report: exec_summary أو cost_sheet. "
                    "format: pdf أو pptx. opportunityId مطلوب لـcost_sheet فقط. "
                    "narrative تعليق عربي قصير بلا أرقام.",
                    [1100, 620]),
    ],
    # يولّد ملفات، والأرقام تُحسب داخل خدمة التقارير — فلا قاعدة هامش ولا facts
    # ولا تمييز مراحل الفرصة تخصّه.
    agent_rules=rules(RULE_EVIDENCE, RULE_READONLY, RULE_ERRORS))


# Wired here rather than beside the Document Agent because the tool nodes are
# defined further down.
for _tool in (find_opportunity, accounts, master_data):
    wire(_tool, "Document Agent", "ai_tool")


# ------------------------------------------------------- knowledge ingestion
#
# Merged into this workflow on request. It shares nothing with the chat path —
# its own trigger, its own nodes, no connection between the two graphs — so the
# only thing they now share is a file and a restart. Worth knowing: a restart to
# deploy an ingestion change also drops the chat for ~30s, which is why these
# were separate to begin with.
INGEST_HOOK = "acms-rag-ingest-01"

INGEST_JS = r"""
const body = $input.first().json.body || $input.first().json;

const REQUIRED = ['docId', 'title', 'text', 'classification', 'docType'];
const missing = REQUIRED.filter((k) => !String(body[k] || '').trim());
if (missing.length) {
  return [{ json: { ok: false, error: 'حقول ناقصة: ' + missing.join('، ') } }];
}

// Rejected, never defaulted. Guessing "internal" puts a contract in front of
// everyone; guessing "confidential" hides something nobody will find again.
const CLASSES = ['internal', 'confidential'];
if (!CLASSES.includes(String(body.classification))) {
  return [{ json: { ok: false,
    error: 'classification لا بد أن تكون: ' + CLASSES.join(' أو ') } }];
}

const text = String(body.text);
if (text.length < 40) {
  return [{ json: { ok: false, error: 'النص أقصر من أن يُفهرس.' } }];
}

return [{
  json: {
    ok: true,
    docId: String(body.docId),
    title: String(body.title),
    text,
    classification: String(body.classification),
    orgUnitId: String(body.orgUnitId || '*'),
    docType: String(body.docType),
    source: String(body.source || 'manual'),
    indexedAt: new Date().toISOString(),
    chars: text.length,
  },
}];
"""

if RAG:
    add({
        "parameters": {"httpMethod": "POST", "path": INGEST_HOOK,
                       "responseMode": "lastNode", "options": {}},
        "type": "n8n-nodes-base.webhook",
        "typeVersion": 2,
        "position": [-1560, 1600],
        "id": "ing-hook",
        "name": "Ingest Request",
        "webhookId": INGEST_HOOK,
        "notes": "POST {docId,title,text,classification,orgUnitId,docType,source}",
    })
    add({
        "parameters": {"jsCode": INGEST_JS},
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [-1300, 1600],
        "id": "ing-validate",
        "name": "Validate Document",
    })
    wire("Ingest Request", "Validate Document")

    add({
        "parameters": {
            "conditions": {
                "options": {"caseSensitive": True, "typeValidation": "loose",
                            "version": 2},
                "conditions": [{"id": "ok", "leftValue": "={{ $json.ok }}",
                                "rightValue": "true",
                                "operator": {"type": "boolean",
                                             "operation": "true",
                                             "singleValue": True}}],
                "combinator": "and",
            },
            "options": {},
        },
        "type": "n8n-nodes-base.if",
        "typeVersion": 2,
        "position": [-1040, 1600],
        "id": "ing-valid",
        "name": "Valid Document?",
    })
    wire("Validate Document", "Valid Document?")

    add({
        "parameters": {
            "mode": "insert",
            "qdrantCollection": {"__rl": True, "mode": "id",
                                 "value": RAG_COLLECTION},
            "options": {},
        },
        "type": "@n8n/n8n-nodes-langchain.vectorStoreQdrant",
        "typeVersion": 1.3,
        "position": [-780, 1520],
        "id": "ing-store",
        "name": "Qdrant · Insert",
        "credentials": QDRANT_CRED,
    })
    connections["Valid Document?"] = {"main": [
        [{"node": "Qdrant · Insert", "type": "main", "index": 0}],
        [{"node": "Rejected", "type": "main", "index": 0}],
    ]}

    add({
        "parameters": {
            "dataType": "json",
            "jsonMode": "expressionData",
            "jsonData": "={{ $json.text }}",
            "textSplittingMode": "custom",
            "options": {"metadata": {"metadataValues": [
                {"name": "docId", "value": "={{ $json.docId }}"},
                {"name": "title", "value": "={{ $json.title }}"},
                {"name": "classification", "value": "={{ $json.classification }}"},
                {"name": "orgUnitId", "value": "={{ $json.orgUnitId }}"},
                {"name": "docType", "value": "={{ $json.docType }}"},
                {"name": "source", "value": "={{ $json.source }}"},
                {"name": "indexedAt", "value": "={{ $json.indexedAt }}"},
            ]}},
        },
        "type": "@n8n/n8n-nodes-langchain.documentDefaultDataLoader",
        "typeVersion": 1.1,
        "position": [-700, 1740],
        "id": "ing-loader",
        "name": "Document Loader",
    })
    wire("Document Loader", "Qdrant · Insert", "ai_document")

    # A policy clause is a paragraph: smaller chunks split the clause from its
    # condition, larger ones bury it.
    add({
        "parameters": {"chunkSize": 1000, "chunkOverlap": 200, "options": {}},
        "type": "@n8n/n8n-nodes-langchain.textSplitterRecursiveCharacterTextSplitter",
        "typeVersion": 1,
        "position": [-700, 1920],
        "id": "ing-splitter",
        "name": "Text Splitter",
    })
    wire("Text Splitter", "Document Loader", "ai_textSplitter")

    add({
        "parameters": {"model": EMBED_MODEL, "options": {}},
        "type": "@n8n/n8n-nodes-langchain.embeddingsOpenAi",
        "typeVersion": 1.2,
        "position": [-900, 1740],
        "id": "ing-embed",
        "name": "Embeddings — الاستيعاب",
        "credentials": OPENAI_CRED,
        "notes": "لا بد أن يطابق نموذج تضمين البحث، وإلا فالفهرس والاستعلام في "
                 "فضاءين مختلفين.",
    })
    wire("Embeddings — الاستيعاب", "Qdrant · Insert", "ai_embedding")

    add({
        "parameters": {"jsCode": "return [{ json: { ok: true, docId: "
                                 "$('Validate Document').first().json.docId } }];"},
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [-520, 1520],
        "id": "ing-done",
        "name": "Indexed",
    })
    wire("Qdrant · Insert", "Indexed")

    add({
        "parameters": {"jsCode": "return [{ json: { ok: false, error: "
                                 "$('Validate Document').first().json.error } }];"},
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [-780, 1700],
        "id": "ing-reject",
        "name": "Rejected",
    })


# ------------------------------------------------------------- sticky notes
#
# Written for someone opening this canvas cold. Each note says what the region
# is *for* and, where a choice looks odd, why it is that way — the canvas cannot
# show intent and the intent is what gets broken later.

def sticky(name, x, y, w, h, colour, content):
    add({
        "parameters": {"content": content, "height": h, "width": w,
                       "color": colour},
        "type": "n8n-nodes-base.stickyNote",
        "typeVersion": 1,
        "position": [x, y],
        "id": "note-" + name,
        "name": "Sticky · " + name,
    })


# ------------------------------------------------------------------- layout
#
# Positions are assigned here rather than at each add() call, so the canvas can
# be reorganised without touching the wiring, and so the sticky notes can be
# sized from where the nodes actually ended up instead of guessed at. The old
# scattered coordinates had a genuine collision — `report_agent` and the Groq
# specialist model sat within 20px of each other.
#
# Reading order is left to right: the request enters at the far left, and every
# band below the spine hangs off the node above it.

AGENT_X = {"sales_intelligence": -700, "financial_intelligence": -200,
           "executive_reporting": 300, "compliance_and_approval": 800,
           "action_agent": 1300, "report_agent": 1800}

# tool name -> (owning agent, row). Shared tools sit under the agent that uses
# them most; the wiring is unchanged either way.
TOOL_ROWS = {
    "sales_intelligence": ["acms_get_opportunity", "acms_list_activities",
                           "acms_bid_deadlines", "acms_list_opportunities"],
    "financial_intelligence": ["acms_opportunity_costing",
                               "acms_quotation_comparison",
                               "acms_find_opportunity"],
    "executive_reporting": ["acms_dashboard_metrics", "acms_metric_explain",
                            "acms_list_accounts"],
    "compliance_and_approval": ["acms_audit_trail", "acms_sod_rules",
                                "acms_approvals_queue"],
    "action_agent": ["acms_propose_action", "acms_master_data"],
    "report_agent": ["acms_generate_report"],
}

LAYOUT = {
    # the spine, left to right
    "When chat message received": (-2400, 0),
    "ACMS Login": (-2180, 0),
    "Approval Gate": (-1800, 0),
    "Confirmed?": (-1580, 0),
    "Has Attachment?": (-1360, 0),
    "ACMS Orchestrator": (-1000, 0),
    "Capture Proposal": (-200, 0),
    # the write path, above the spine — it bypasses the model entirely
    "Execute Action": (-1800, -700),
    "Execution Result": (-1580, -700),
    # documents, higher still
    "Route By Type": (-1300, -1400),
    "Extract PDF": (-1080, -1580),
    "Extract Sheet": (-1080, -1460),
    "Extract CSV": (-1080, -1340),
    "Extract Text": (-1080, -1220),
    "Prepare Document": (-840, -1400),
    "Document Agent": (-600, -1400),
    "OpenAI — المستندات": (-600, -1650),
    "Groq — المستندات": (-380, -1650),
    "Ollama — المستندات": (-160, -1650),
    # everything the orchestrator owns, hanging below it
    "OpenAI — المنسّق": (-1000, 240),
    "Groq — المنسّق": (-1000, 360),
    "Ollama — المنسّق": (-1000, 480),
    "Simple Memory": (-780, 240),
    "Specialist Output": (-780, 380),
    "OpenAI — المتخصصون": (-560, 240),
    "Groq — المتخصصون": (-560, 360),
    "Ollama — المتخصصون": (-560, 480),
    # the knowledge layer, on its own to the right
    "acms_knowledge_search": (2350, 1000),
    "Embeddings — المعرفة": (2350, 1160),
    # ingestion, far below and connected to nothing above it
    "Ingest Request": (-2400, 2200),
    "Validate Document": (-2160, 2200),
    "Valid Document?": (-1920, 2200),
    "Qdrant · Insert": (-1660, 2120),
    "Indexed": (-1420, 2120),
    "Rejected": (-1420, 2300),
    "Embeddings — الاستيعاب": (-1860, 2440),
    "Document Loader": (-1640, 2440),
    "Text Splitter": (-1640, 2620),
}

for _agent, _x in AGENT_X.items():
    LAYOUT[_agent] = (_x, 1000)
    for _row, _tool in enumerate(TOOL_ROWS.get(_agent, [])):
        LAYOUT[_tool] = (_x, 1180 + _row * 150)


def apply_layout():
    """Move every node whose position this table owns; leave the rest alone."""
    missing = []
    for n in nodes:
        if n["type"].endswith("stickyNote"):
            continue
        if n["name"] in LAYOUT:
            n["position"] = list(LAYOUT[n["name"]])
        else:
            missing.append(n["name"])
    if missing:
        # Loud on purpose: a node added later without a position lands wherever
        # its add() call left it and quietly falls outside every sticky note.
        print("  !! no layout entry, left where it was: " + ", ".join(missing))


def group_box(names, pad_x=50, pad_y=130, top=190):
    """A rectangle that wraps the given nodes, with room for the note's title."""
    pts = [n["position"] for n in nodes if n["name"] in names]
    if not pts:
        return None
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    # n8n draws a node roughly 200x120 from its position point.
    x0, y0 = min(xs) - pad_x, min(ys) - top
    x1, y1 = max(xs) + 200 + pad_x, max(ys) + 120 + pad_y
    return [x0, y0, x1 - x0, y1 - y0]


GROUPS = {
    "المدخل والهوية": ["When chat message received", "ACMS Login"],
    "البوابة الحتمية": ["Approval Gate", "Confirmed?", "Has Attachment?"],
    "مسار التنفيذ": ["Execute Action", "Execution Result"],
    "مسار المستندات": ["Route By Type", "Extract PDF", "Extract Sheet",
                       "Extract CSV", "Extract Text", "Prepare Document",
                       "Document Agent", "OpenAI — المستندات",
                       "Groq — المستندات", "Ollama — المستندات"],
    "المنسّق والنماذج": ["ACMS Orchestrator", "OpenAI — المنسّق",
                          "Groq — المنسّق", "Ollama — المنسّق", "Simple Memory",
                          "OpenAI — المتخصصون", "Groq — المتخصصون",
                          "Ollama — المتخصصون", "Specialist Output"],
    "التسليم": ["Capture Proposal"],
    "المتخصصون": list(AGENT_X) + [t for ts in TOOL_ROWS.values() for t in ts],
    "طبقة المعرفة": ["acms_knowledge_search", "Embeddings — المعرفة"],
    "الاستيعاب": ["Ingest Request", "Validate Document", "Valid Document?",
                  "Qdrant · Insert", "Indexed", "Rejected",
                  "Embeddings — الاستيعاب", "Document Loader", "Text Splitter"],
}

# n8n sticky colours: 1 grey · 2 brown · 3 red · 4 orange · 5 yellow · 6 green
# · 7 blue/purple
NOTE_TEXT = [
    ("المدخل والهوية", 7,
     "## 1 · المدخل والهوية\n"
     "المحادثة تدخل من هنا، و**ACMS Login** يحوّل الجلسة إلى توكن المستخدم "
     "الحقيقي.\n\n"
     "`ACMS_IDENTITY_MODE=required` — الجلسة غير المرتبطة لا تحصل على توكن، "
     "وتُطالَب بـ`/login`. كلمة السر لا تمرّ من هنا أبدًا: المستخدم يسجّل في "
     "صفحة الدخول ويعود برمز ربط.\n\n"
     "⚠️ حزمة الانحدار تستخدم جلسات غير مرتبطة، فشغّلها عبر "
     "`acms-regress/run-regress.sh` الذي يخفّض الوضع مؤقتًا ويعيده."),

    ("البوابة الحتمية", 4,
     "## 2 · البوابة الحتمية — بلا نموذج\n"
     "**Approval Gate** يقرّر كل شيء بالكود قبل أن يُستدعى أي نموذج:\n"
     "- النية والتوجيه (مطابقة نصية — `\\b` لا تعمل مع العربية)\n"
     "- المسار: تنفيذ / ردّ جاهز / محادثة\n"
     "- **أي نموذج** يشغّل المتخصصين (`specModel`)\n"
     "- **أي أصناف وثائق** يُسمح بها (`ragClasses`)\n"
     "- فحص حقن الأوامر، وحدّ 8000 حرف\n"
     "- البحث في ذاكرة الإجابات\n\n"
     "التحية و«ماذا تستطيع؟» تُجاب من هنا في ~750ms بلا أي توكن."),

    ("مسار التنفيذ", 3,
     "## 3 · مسار الكتابة — خالٍ من النموذج\n"
     "بعد أن يكتب المستخدم رقم التأكيد، الطلب المخزَّن يُعاد إرساله كما هو. "
     "**النموذج غائب عن هذا المسار تمامًا** — لا يقرّر المسار ولا الحمولة.\n\n"
     "الرقم يُستهلك مرة واحدة؛ إعادته أو تخمينه لا تُنتج أي أثر."),

    ("مسار المستندات", 5,
     "## 4 · المستندات\n"
     "الملف المرفوع يصل كـ`data0`، ويُوجَّه حسب الامتداد إلى أحد أربعة مستخرجات "
     "ثم إلى **Prepare Document**.\n\n"
     "**الحساب يتم في الكود لا في النموذج:** الأعمدة الرقمية تُجمَع وتُسلَّم "
     "كحقائق. طُلب من النموذج جمع BOQ فأخرج ستة أسطر صحيحة ومجموعًا يزيد 1000، "
     "وعلى النص الخام اخترع 420,985 بدل 1,469,340."),

    ("المنسّق والنماذج", 6,
     "## 5 · المنسّق\n"
     "يوزّع فقط — لا يملك بيانات ولا يحسب.\n\n"
     "**المزوّد النشط: OpenAI وحده.**\n"
     "Groq وOllama موجودتان ومعطَّلتان (Disabled) عمدًا — للرجوع المستقبلي "
     "بقرار صريح، لا كاحتياطي تلقائي.\n\n"
     "المنسّق على `gpt-4o-mini`، والمتخصصون يختارون النموذج لكل سؤال حسب "
     "النية القادمة من البوابة."),

    ("المتخصصون", 6,
     "## 6 · الوكلاء المتخصصون\n"
     "كل واحد وكيل كامل بتعليماته وأدواته. القواعد مركّبة لكل وكيل — لا كتلة "
     "واحدة للجميع: إخبار `action_agent` أنه «للقراءة فقط» كان تناقضًا جعله "
     "يرفض عملًا من صميم مهمته.\n\n"
     "الأدوات أسفلهم تقرأ عبر طبقة `/q/*` التي تُسقِط الحقول غير المطلوبة "
     "وتحسب الحقائق — لا عبر ACMS مباشرة."),

    ("طبقة المعرفة", 7,
     "## 7 · المعرفة (RAG)\n"
     "بحث في وثائق الشركة عبر Qdrant محلي.\n\n"
     "**الحدّ:** ACMS مصدر بيانات النظام، والوثائق مصدر المعرفة المكتوبة. أي "
     "رقم عن فرصة أو تكلفة أو حالة يأتي من ACMS — ولو ورد في وثيقة فالوثيقة "
     "قديمة.\n\n"
     "الفلتر **تعبير ثابت** يقرأ `ragClasses` من البوابة، لا `$fromAI`. "
     "النموذج يختار الاستعلام، لا ما يُسمح له برؤيته."),

    ("التسليم", 4,
     "## 8 · التسليم\n"
     "**Capture Proposal** هي آخر ما يلمس الإجابة:\n"
     "- يفحصها حارس المخرجات (تسريب، كود لم يُقدَّم، ادّعاء تنفيذ)\n"
     "- يُلحق المصادر **من سجل الأدلة** لا من كلام النموذج\n"
     "- يخزّن الإجابة في الذاكرة إن كانت صالحة\n\n"
     "المخطط المهيكل لا يطلب `evidence` من النموذج عمدًا: حقل إلزامي بلا قيمة "
     "صحيحة يُنتِج اختلاقًا، لا إسنادًا."),

    ("الاستيعاب", 2,
     "## 9 · استيعاب الوثائق — مسار منفصل\n"
     "`POST /webhook/acms-rag-ingest-01`\n"
     "`{docId, title, text, classification, orgUnitId, docType, source}`\n\n"
     "**لا يتصل بمسار المحادثة إطلاقًا** — مخطط مستقل داخل نفس الملف.\n\n"
     "`classification` إما `internal` أو `confidential`، و**الوثيقة بلا تصنيف "
     "تُرفض ولا تُخمَّن**.\n\n"
     "التقطيع 1000/200. نموذج التضمين هنا **يجب** أن يطابق نموذج البحث في "
     "طبقة المعرفة، وإلا فالفهرسة والاستعلام في فضاءين مختلفين ولن يظهر خطأ "
     "— فقط نتائج بلا معنى.\n\n"
     "الدفع من `n8n/push_docs.py`."),
]


def main():
    if RAG:
        apply_layout()
        boxes = {}
        for label, colour, content in NOTE_TEXT:
            box = group_box(GROUPS[label])
            if box is None:
                continue
            boxes[label] = box
            sticky(label, box[0], box[1], box[2], box[3], colour, content)
        # Two notes overlapping means two groups interleave on the canvas, which
        # is a layout bug, not a cosmetic one — the reader cannot tell which
        # region a node belongs to.
        items = list(boxes.items())
        for i, (na, a) in enumerate(items):
            for nb, b in items[i + 1:]:
                if not (a[0] + a[2] <= b[0] or b[0] + b[2] <= a[0]
                        or a[1] + a[3] <= b[1] or b[1] + b[3] <= a[1]):
                    print("  !! notes overlap: %s / %s" % (na, nb))
    os.makedirs(OUT, exist_ok=True)
    wf = {
        "id": WF_ID,
        "name": WF_NAME,
        "active": True,
        "settings": {"executionOrder": "v1"},
        "nodes": nodes,
        "connections": connections,
    }
    path = os.path.join(OUT, WF_ID + ".json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(wf, fh, ensure_ascii=False, indent=2)

    kinds = {}
    for n in nodes:
        kinds[n["type"].split(".")[-1]] = kinds.get(n["type"].split(".")[-1], 0) + 1
    print(f"{WF_ID}.json — {len(nodes)} nodes, provider={PROVIDER}, "
          f"doc_provider={DOC_PROVIDER}")
    # Print the resulting model wiring rather than trusting the constants:
    # exactly one node per consumer must be enabled, and a silent second one
    # would send production traffic to a standby provider.
    for n in nodes:
        if "lmChat" in n["type"]:
            state = "DISABLED" if n.get("disabled") else "ACTIVE  "
            print(f"    {state}  {n['name']}")
    for k, v in sorted(kinds.items(), key=lambda kv: -kv[1]):
        print(f"  {v:>2}  {k}")


if __name__ == "__main__":
    main()
