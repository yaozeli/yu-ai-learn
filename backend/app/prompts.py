from langchain_core.prompts import ChatPromptTemplate


QUIZ_PROMPT_VERSION = "quiz_prompt_v1"
REPORT_PROMPT_VERSION = "report_prompt_v1"

QUIZ_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "你是一名专业的 AI 学习教练。请严格根据用户学习内容生成结构化闯关题库。"
            "只输出符合 Schema 的内容，不要输出 Markdown 或额外说明。",
        ),
        (
            "human",
            "学习内容：{user_input}\n\n"
            "要求：生成 5 道题，包含 3 道 single、1 道 multiple、1 道 judge。"
            "覆盖核心概念、易错点和应用判断。选项使用 A-D，answer 必须是选项 key。"
            "讲解面向初学者，知识点标签清晰，内容不能偏离学习主题。",
        ),
    ]
)

REPORT_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "你是一名学习复盘教练。只输出符合 Schema 的结构化报告，"
            "报告必须基于题库和真实答题记录，不编造未出现的结论。",
        ),
        (
            "human",
            "主题：{topic}\n题库：{quiz_json}\n答题记录：{answer_records}\n"
            "统计：正确 {correct_count}/{total_count}，正确率 {accuracy}%\n"
            "请输出掌握点、薄弱点、三句知识总结、后续建议和分享金句。",
        ),
    ]
)