# The bought-in cars

Five vehicles from CGTrader's free models, each under the CGTrader Royalty Free License (no AI use).
The page draws them as converted by `scripts/blender_city_cars.py` and `scripts/build_city_cars.mjs` from `scripts/city_cars.json`.
The conversion turned, scaled and split each model, and reduced it to three levels (full, npc, mid) with colours baked per vertex. No source file, texture or untouched mesh is shipped.

How often each is drawn is California's 2024 new-vehicle registrations of the model, from the CNCDA California Auto Outlook (Q4 2024, data from Experian).
Where a model is no longer sold, its successor's count is used.

| Model | Drawn as | Source | Author | 2024 CA registrations |
|---|---|---|---|---|
| Honda Civic (10th generation, FK8) | sedan | [CGTrader](https://www.cgtrader.com/free-3d-models/car/sport-car/2018-honda-civic-type-r) (FK8.blend + Textures.zip) | CGTrader seller of model #3746622 | 53,049 (Honda Civic) |
| Hyundai Sonata (seventh generation, LF) | sedan | [CGTrader](https://www.cgtrader.com/free-3d-models/car/luxury-car/hyundai-sonata-2016-2017-with-engine-and-bumpers-support) (Hyundai Sonata 2016 - Obj.rar + texture.rar) | Alqhtani | 6,108 (Hyundai Sonata) |
| Mercedes-Benz GLK 350 (X204, 2014) | suv | [CGTrader](https://www.cgtrader.com/free-3d-models/car/suv/mercedes-benz-glk-350-suv-2014) (glk.blend) | CGTrader seller of model #2861229 | 9,527 (Mercedes-Benz GLC-Class (the GLK's successor)) |
| Nissan Frontier (D22 crew cab, 2004) | pickup | [CGTrader](https://www.cgtrader.com/free-3d-models/vehicle/truck/nissan-frontier-pickup-truck-2004) (Nissan Frontier Pickup Truck 2004.glb) | DigitalArt3d | 5,923 (Nissan Frontier) |
| Opel Movano L3H2 (2023), drawn as the Ram ProMaster high roof | delivery_van | [CGTrader](https://www.cgtrader.com/free-3d-models/car/car/modern-delivery-van) (Opel Movano Van .zip) | CharlotteUA | not counted (every delivery van is drawn as it) |

The licence allows the models in commercial and non-commercial projects. They may not be resold or redistributed as models, and may not be used to train AI.

The van was sold with both pairs of back doors swung open: the conversion swings them shut (`open_doors` in `scripts/city_cars.json`) and leaves out the cargo space and its racking.
