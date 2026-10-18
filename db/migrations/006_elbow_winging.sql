-- Elbow winging joins the routine, and wall walks are now done side-on to the wall, facing the
-- camera, its most reliable angle. The app reads exercises from its own list; these rows keep the
-- foreign keys and the database's copy in step.
insert into exercises (id, name, camera_view, instructions) values
  ('elbow_wing', 'Elbow winging', 'front', 'Clasp your hands behind your head, elbows together in front. Open your elbows out wide, then bring them back together.')
on conflict (id) do nothing;

update exercises
   set camera_view = 'front',
       instructions = 'Stand side-on to a wall with your working arm next to it. Walk your fingers up the wall as high as is comfortable, then walk them back down.'
 where id = 'wall_walk';
