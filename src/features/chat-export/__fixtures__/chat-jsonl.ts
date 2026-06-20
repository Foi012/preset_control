/**
 * Trimmed `.jsonl` fixture modelled on a real ST chat
 * (`月亮下的黄石 …jsonl`): line 1 is the chat **header** (metadata, no `mes`),
 * then message lines. Adds cases the real 2-line file lacked: an assistant message
 * with a `swipes` array + `swipe_id` + `extra.reasoning`, a system message, and a
 * malformed line — so the normalizer's skip/active-swipe/role logic is exercised.
 */
export const sampleJsonl = [
  // 0: chat header — valid JSON object, but no `mes` → dropped as a non-message.
  '{"user_name":"Ruth","character_name":"月亮下的黄石","create_date":"2026-06-02@10h15m50s","chat_metadata":{"variables":{"plot":"(建立新亲密关系)"}}}',
  // 1: user message (no swipes).
  '{"name":"Ruth","is_user":true,"is_system":false,"mes":"请为用户编写一个开场。","extra":{"reasoning":""}}',
  // 2: assistant message — active swipe is index 1; `mes` mirrors it; has reasoning.
  '{"name":"月亮下的黄石","is_user":false,"is_system":false,"swipe_id":1,"swipes":["第一个候选回复。","月光落在黄石公园的松林上。"],"mes":"月光落在黄石公园的松林上。","extra":{"reasoning":"先确定 POV 与节奏。"}}',
  // 3: a /hide-d assistant turn — is_system:true but NO extra.type → real content, hidden.
  '{"name":"月亮下的黄石","is_user":false,"is_system":true,"mes":"被隐藏的旧章节，仍是正文。","extra":{"reasoning":""}}',
  // 4: a genuine system message (/comment) — extra.type set → real "系统消息", not hidden.
  '{"name":"注释","is_user":false,"is_system":true,"mes":"作者注：这里是注释。","extra":{"type":"comment"}}',
  // 5: malformed — skipped, must not throw.
  '{"name":"broken", not json',
  // 6: blank line — skipped.
  '',
].join('\n');
