-- Two more exercises from the standard post-mastectomy routine. Wall walks are measured like
-- the other raises; shoulder rolls are counted, not measured, so they never take a limit or goal.
insert into exercises (id, name, camera_view, instructions) values
  ('wall_walk', 'Wall walk', 'side', 'Stand facing a wall. Walk your fingers up the wall as high as is comfortable, then walk them back down.'),
  ('shoulder_roll', 'Shoulder rolls', 'front', 'Face the camera with your arms relaxed. Roll your shoulders up, back and down.')
on conflict (id) do nothing;
