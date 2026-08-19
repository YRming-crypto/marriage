DROP INDEX IF EXISTS "messages_conversation_id_client_message_id_key";

CREATE UNIQUE INDEX "messages_conversation_id_sender_id_client_message_id_key"
ON "messages"("conversation_id", "sender_id", "client_message_id");
