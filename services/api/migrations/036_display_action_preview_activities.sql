ALTER TABLE display_setups DROP CONSTRAINT display_setups_cards_check;
ALTER TABLE display_setups ADD CONSTRAINT display_setups_cards_check
  CHECK (jsonb_typeof(cards)='array' AND jsonb_array_length(cards)<=14);
ALTER TABLE display_setups DROP CONSTRAINT display_setups_card_order_check;
ALTER TABLE display_setups ADD CONSTRAINT display_setups_card_order_check
  CHECK (jsonb_typeof(card_order)='array' AND jsonb_array_length(card_order)<=14);
