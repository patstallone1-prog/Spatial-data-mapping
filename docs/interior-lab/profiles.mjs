// Editor programs are game design guidance, never a declaration of building-code compliance.
export const EDITABLE_SCHEMAS = new Set(['kerbside.inferred_house/1','kerbside.inferred_residential/1','kerbside.inferred_restaurant/1','kerbside.inferred_store/1','kerbside.inferred_specialty_shop/1','kerbside.inferred_business/1']);
export const isBusiness = h => Boolean(h&&EDITABLE_SCHEMAS.has(h.schema)) && !['kerbside.inferred_house/1','kerbside.inferred_residential/1'].includes(h.schema);
export const protectedArea = (h,r) => isBusiness(h) && /parking|garage|ramp|forecourt|charging_bay|fuel_island/.test(r.kind);
export const fixedObject = o => o.measured===true || o.structural===true || /^(structural_column|structural_beam|fuel_pump|ev_charger)$/.test(o.role);
export const ALIASES = {
  american:'restaurant',mexican:'restaurant',japanese:'restaurant',chinese:'restaurant',thai:'restaurant',vietnamese:'restaurant',indian:'restaurant',korean:'restaurant',italian:'restaurant',mediterranean:'restaurant',seafood:'restaurant',deli:'fast_food',ice_cream:'cafe',
  convenience:'corner_store',liquor:'corner_store',wine_shop:'corner_store',smoke_shop:'corner_store',general:'shop',gifts:'shop',toys:'shop',pet:'shop',home:'shop',gallery:'books',shoes:'clothing',electronics:'hardware',phone_store:'hardware',auto_parts:'hardware',bike:'hardware',
  beauty:'salon',nail_salon:'salon',spa:'salon',pet_grooming:'salon',dry_cleaner:'laundry',dentist:'dental',optician:'clinic',vet:'clinic',law_office:'office',staffing:'office',print_ship:'office',fuel:'gas_station',charging_station:'ev_charging',hospital:'hospital'
};
const program=(label,group,primary,roles,back='stockroom')=>({label,group,primary,roles,back});
export const PROGRAMS = {
 restaurant:program('Restaurant','Food & drink','dining',['dining_table','dining_chair','booth','service_counter'],'professional_kitchen'),
 cafe:program('Café','Food & drink','dining',['dining_table','dining_chair','booth','coffee_cart','service_counter'],'professional_kitchen'),
 diner:program('Diner','Food & drink','dining',['dining_table','dining_chair','booth','bar_stool'],'professional_kitchen'),
 fast_food:program('Takeaway & fast food','Food & drink','customer_area',['service_counter','dining_table','dining_chair','payment_terminal'],'professional_kitchen'),
 pizza:program('Pizzeria','Food & drink','dining',['dining_table','dining_chair','booth','service_counter'],'professional_kitchen'),
 bakery:program('Bakery','Food & drink','sales_floor',['bakery_display','service_counter','dining_table','dining_chair'],'professional_kitchen'),
 bar:program('Bar','Food & drink','bar',['bar_counter','bar_stool','booth','dining_table','dining_chair'],'professional_kitchen'),
 grocery:program('Grocery store','Retail','sales_floor',['gondola_shelf','produce_bin','refrigerated_case','freezer_case','checkout_lane','self_checkout'],'stockroom'),
 corner_store:program('Corner store','Retail','sales_floor',['gondola_shelf','drink_cooler','checkout_lane','service_counter'],'stockroom'),
 pharmacy:program('Pharmacy','Healthcare','sales_floor',['gondola_shelf','medicine_cabinet','service_counter','medical_cart'],'dispensary'),
 jewelry:program('Jewelry store','Retail','sales_floor',['jewelry_case','display_plinth','service_counter','armchair'],'jeweler_workshop'),
 clothing:program('Clothing & shoes','Retail','sales_floor',['clothing_rail','display_table','service_counter','bench'],'fitting_room'),
 books:program('Bookshop & gallery','Retail','sales_floor',['bookshelf','display_table','armchair','service_counter'],'stockroom'),
 hardware:program('Hardware & electronics','Retail','sales_floor',['gondola_shelf','display_table','workbench','service_counter'],'workshop'),
 florist:program('Florist','Retail','sales_floor',['plant_display','display_table','service_counter','floor_plant_pot'],'workshop'),
 shop:program('General retail','Retail','sales_floor',['gondola_shelf','display_table','service_counter','checkout_lane'],'stockroom'),
 barber:program('Barbershop','Personal services','styling_floor',['barber_chair','styling_station','reception_desk','waiting_bench'],'staff_room'),
 salon:program('Salon & spa','Personal services','styling_floor',['salon_chair','styling_station','shampoo_station','reception_desk','waiting_bench'],'treatment_room'),
 laundry:program('Laundry & dry cleaning','Personal services','laundry_floor',['commercial_washer','commercial_dryer','folding_table','laundry_cart','waiting_bench'],'utility'),
 clinic:program('Clinic','Healthcare','reception',['reception_desk','waiting_bench','armchair'],'examination_room'),
 dental:program('Dental practice','Healthcare','reception',['reception_desk','waiting_bench'],'dental_room'),
 hospital:program('Hospital ward','Healthcare','ward',['hospital_bed','patient_monitor','medical_cart','privacy_screen','iv_stand'],'nurse_station'),
 senior_living:program('Senior living','Healthcare','common_room',['sofa','armchair','dining_table','dining_chair'],'resident_room'),
 office:program('Office','Work & community','office',['desk','office_chair','bookshelf','meeting_table','reception_desk'],'meeting_room'),
 bank:program('Bank','Work & community','banking_hall',['service_counter','reception_desk','waiting_bench','desk'],'secure_office'),
 civic:program('Civic & community','Work & community','community_room',['meeting_table','dining_chair','bookshelf','reception_desk'],'office'),
 school:program('School','Work & community','classroom',['desk','dining_chair','bookshelf','storage_cabinet'],'staff_room'),
 hotel:program('Hotel','Work & community','lobby',['reception_desk','sofa','armchair','coffee_table'],'guest_room'),
 industrial:program('Workshop & warehouse','Work & community','workshop',['workbench','dry_storage','storage_cabinet','prep_table'],'office'),
 gym:program('Gym','Personal services','fitness_floor',['treadmill','exercise_bench','storage_cabinet','reception_desk'],'changing_room'),
 car_dealership:program('Car dealership','Automotive','showroom',['parked_car','reception_desk','desk','office_chair'],'sales_office'),
 gas_station:program('Gas station convenience store','Automotive','sales_floor',['gondola_shelf','drink_cooler','service_counter','checkout_lane'],'stockroom'),
 ev_charging:program('EV charging lounge','Automotive','lounge',['sofa','armchair','coffee_table','service_counter'],'utility')
};
export const profileFor = h => PROGRAMS[ALIASES[h.kind]||h.kind] || PROGRAMS[h.schema==='kerbside.inferred_restaurant/1'?'restaurant':h.schema==='kerbside.inferred_store/1'?'shop':'office'];
export const businessKind = kind => ALIASES[kind]||kind;
export const businessLabel = kind => (PROGRAMS[kind]?.label || String(kind).replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase()));
export const ROOM_ROLES = {
 dining:['dining_set','dining_table','dining_chair','booth','service_counter','bar_stool'],bar:['bar_counter','bar_stool','booth','dining_table','dining_chair'],customer_area:['service_counter','dining_table','dining_chair','payment_terminal'],
 professional_kitchen:['prep_station','commercial_range','commercial_fridge','warewash_sink','handwash_sink','dishwasher','prep_table','dry_storage','waste_bin'],
 stockroom:['stock_crate','dry_storage','storage_cabinet','prep_table','waste_bin','commercial_fridge'],staff_room:['desk','dining_table','dining_chair','storage_cabinet','counter','refrigerator'],
 examination_room:['examination_table','medical_cart','medicine_cabinet','patient_monitor','iv_stand','doctor_scale','privacy_screen','handwash_sink'],
 dental_room:['dentist_chair','medical_cart','medicine_cabinet','handwash_sink'],ward:['hospital_bed','patient_monitor','medical_cart','privacy_screen','iv_stand','waiting_bench'],
 nurse_station:['desk','office_chair','medical_cart','medicine_cabinet','handwash_sink'],dispensary:['medicine_cabinet','prep_table','storage_cabinet','handwash_sink'],
 treatment_room:['examination_table','salon_chair','medical_cart','handwash_sink','storage_cabinet'],styling_floor:['barber_chair','salon_chair','styling_station','shampoo_station','reception_desk','waiting_bench'],
 laundry_floor:['commercial_washer','commercial_dryer','folding_table','laundry_cart','waiting_bench','payment_terminal'],utility:['washing_machine','clothes_dryer','commercial_washer','commercial_dryer','storage_cabinet','handwash_sink'],
 jeweler_workshop:['jeweler_bench','safe','storage_cabinet','desk','office_chair'],workshop:['workbench','dry_storage','storage_cabinet','prep_table'],
 showroom:['parked_car','desk','office_chair','reception_desk','waiting_bench'],fitness_floor:['treadmill','exercise_bench','storage_cabinet','reception_desk'],
 toilet:['toilet','bath_sink','handwash_sink','waste_bin'],bathroom:['toilet','bath_sink','shower','bath_shower','waste_bin'],changing_room:['bench','storage_cabinet','clothing_rail'],fitting_room:['bench','clothing_rail'],
 office:['desk','office_chair','bookshelf','meeting_table','storage_cabinet'],meeting_room:['meeting_table','office_chair','bookshelf'],sales_office:['desk','office_chair','storage_cabinet'],secure_office:['desk','office_chair','safe','storage_cabinet'],
 guest_room:['bed','nightstand','dresser','desk','armchair'],resident_room:['hospital_bed','bed','nightstand','dresser','armchair'],classroom:['desk','dining_chair','bookshelf','storage_cabinet'],
 reception:['reception_desk','waiting_bench','armchair','coffee_table'],lobby:['reception_desk','sofa','armchair','coffee_table'],lounge:['sofa','armchair','coffee_table','service_counter'],common_room:['sofa','armchair','dining_table','dining_chair'],community_room:['meeting_table','dining_chair','bookshelf','reception_desk'],banking_hall:['service_counter','desk','waiting_bench','reception_desk']
};
export const FIXTURES = {
 toilet:[.45,.8,.7],bath_sink:[.7,.85,.5],shower:[.9,2.1,.9],bath_shower:[.8,.55,1.7],sink_counter:[1.2,.9,.6],counter:[1.2,.9,.6],cooker:[.6,.9,.6],refrigerator:[.7,1.9,.7],dishwasher:[.6,.85,.6],washing_machine:[.6,.85,.65],clothes_dryer:[.6,.85,.65],
 service_counter:[1.6,.95,.65],payment_terminal:[.24,.22,.22],commercial_range:[1.2,.95,.8],commercial_fridge:[1,2,.8],warewash_sink:[1.8,.9,.7],handwash_sink:[.5,.85,.45],prep_table:[1.8,.9,.75],dry_storage:[1.2,1.9,.5],waste_bin:[.45,.7,.45],
 booth:[1.5,1.2,.75],bar_counter:[2.4,1.05,.65],gondola_shelf:[1.6,1.7,.8],drink_cooler:[1.2,2,.7],refrigerated_case:[2,1.8,.8],freezer_case:[1.8,.9,.9],produce_bin:[1.4,.85,.9],bakery_display:[1.6,1.3,.75],checkout_lane:[1.2,.95,2.2],self_checkout:[.7,1.3,.8],
 jewelry_case:[1.5,1.05,.65],display_plinth:[.6,1.1,.6],display_table:[1.4,.8,.8],clothing_rail:[1.4,1.7,.55],plant_display:[1.2,1.4,.55],barber_chair:[.75,1.2,1.05],salon_chair:[.7,1.05,.8],styling_station:[1.2,1.9,.45],shampoo_station:[.8,1.15,1.4],reception_desk:[1.6,1.05,.7],waiting_bench:[1.8,.9,.65],bench:[1.5,.85,.6],
 commercial_washer:[.85,1.2,.9],commercial_dryer:[.85,1.9,.9],folding_table:[1.8,.9,.85],laundry_cart:[.7,.85,.55],jeweler_bench:[1.2,.85,.65],safe:[.7,1.2,.65],storage_cabinet:[1,1.8,.5],workbench:[1.6,.9,.7],meeting_table:[2.4,.75,1.1],desk:[1.3,.75,.65],office_chair:[.65,1.1,.65],dining_table:[1.2,.75,.75],dining_chair:[.5,.9,.55],sofa:[2.1,.9,.9],armchair:[.8,.9,.8],coffee_table:[1.1,.45,.6],bookshelf:[1.2,1.8,.4],bar_stool:[.45,.85,.45],bed:[1.5,1,2],nightstand:[.5,.55,.45],dresser:[1.2,.9,.5],
 hospital_bed:[1.05,1.2,2.2],examination_table:[.75,.9,1.9],dentist_chair:[1,1.6,2],medical_cart:[.65,1,.5],medicine_cabinet:[1,1.8,.4],patient_monitor:[.55,1.4,.5],iv_stand:[.6,1.9,.6],privacy_screen:[1.8,1.7,.35],doctor_scale:[.55,1.6,.55],treadmill:[.85,1.4,1.8],exercise_bench:[.65,.55,1.3],parked_car:[1.85,1.5,4.4]
};
