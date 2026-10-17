-- Clinicians add patients themselves. A patient's Auth0 login lands on the record whose email
-- matches the address they sign in with, and the PT's note is shown before every session.
alter table patients add column email text;
alter table patients add column plan_note text;
create unique index patients_email on patients (lower(email));
