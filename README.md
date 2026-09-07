# Newton's cenotaph, in Blender

A 3D reconstruction of Étienne-Louis Boullée's 1784 *Cénotaphe à Newton*, built
from his six surviving drawings in the Bibliothèque nationale de France
(Département des estampes, RÉS. HA 57; Gallica ark:/12148/btv1b7701015b).
The monument was never built and Boullée left no dimensioned plans, so every
number here is a proportion measured off the drawings and scaled to the
150 m (roughly 500 French feet) sphere that the literature agrees on.

## Files

- `newton_cenotaph.blend` - the model. Blender 5.2.
- `render_views.py` - headless render of the five presentation views into `renders/`.
  `Blender -b newton_cenotaph.blend -P render_views.py` (add `-- --quick` for a fast preview).
- `renders/` - exterior elevation, interior by day (stars), interior by night (armillary lamp),
  cross-section, plan.

## What the drawings show, and what I took from each

| Gallica folio | Drawing | Used for |
|---|---|---|
| f1 | Plan | radii of the three cypress rings, the entrance axis, the stair positions |
| f2, f3 | Perspective elevations, day and night effect | drum and upper tier heights, the front notch, the monumental stair up the front of the upper tier, the tunnel arch at the foot of the sphere |
| f4 | Section, "night with day effect" | shell thickness, the vaulted gallery inside the drum, the sarcophagus on its mound, the star perforations |
| f5 | Section, night effect | the armillary sphere lamp hanging at the centre |
| f6 | Interior view | the single large "moon" opening, viewpoint for the interior render |

## Proportions used (R = sphere radius = 75 m)

| Element | Proportion | Metres |
|---|---|---|
| Sphere | diameter 2R, resting on the ground | 150 |
| Shell thickness | from the section | 5 |
| Lower drum | radius 1.55R, height 0.5R | 116 × 37.5 |
| Upper tier | radius 1.25R, top at 0.75R | 94 × 56 |
| Ground platform | radius 2.05R | 154 |
| Cypress rings | ground 1.78-1.94R, drum terrace 1.30-1.46R, upper terrace 1.07-1.15R | three rows, three rows, two rows |
| Front notch | sector of ±40° through the drum | ~ the sphere's width at the drum face |
| Gallery inside the drum | annular vault, radius 12 m, centred at 1.42R | |
| Tunnel | 9 m wide, floor 6 m above ground | |
| Armillary lamp | radius 0.24R | 18 |

## Honest caveats

- The two sections (f4, f5) draw the drum wider relative to the sphere than the two
  elevations (f2, f3) do, roughly 1.77R against 1.57R. The plan sides with the
  elevations, so I used 1.55R.
- The elevations show the sphere sitting in a concave cradle with the front cut open;
  the sections show masonry hugging the sphere with no gap. I modelled the cradle,
  because that is what you would see.
- The curving stairs Boullée sketches around the sphere in the plan are not modelled.
- The star perforations are a material effect (emissive pinpoints on the inner surface),
  not several thousand real holes. The exterior sphere is smooth, as in the drawings.
- Cypresses are roughly 1,900 instanced spindles, not botanical trees.

## Working in the file

- Collections: Base, Sphere, Interior, Planting, Cutters (hidden boolean cutters), Cameras & Lights.
- Every base object has a disabled `SECTION` boolean modifier. Turn them on to cut the
  front half away, as the section render does. The cut plane sits at y = 0.37 m rather
  than 0, deliberately: a plane through the meshes' own vertex rows breaks the boolean.
- All booleans use Blender's Manifold solver. The Exact solver failed silently on
  several of these cuts (a cylinder with a sphere subtracted, for one), which cost
  an afternoon.
- The `StarsOn` value node in the `Sphere_Shell` material switches the day-effect stars.
- Two worlds: `Day sky` and `Night`.
- Cypresses are scattered by the `CypressScatter` geometry-nodes group from three point
  clouds; edit the point clouds to replant.
