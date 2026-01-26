UPDATE "inbox_items" SET "type" = 'feedback' WHERE "type" IN ('alert', 'signal', 'input_request');
