-- The PT's movement reminder for the armband: it chirps after this many minutes without the arm
-- going above 60°. 0 turns it off. The band's limit comes from the exercise plan instead.
alter table patients add column reminder_minutes smallint not null default 0 check (reminder_minutes between 0 and 240);
