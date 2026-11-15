// Lightweight fallbacks while optional imported models load. All parts use the object's support box.
export function businessFixture(T,parent,o,style){
 const aliases={jewelry_island:'jewelry_case',jewelry_wall_case:'jewelry_case',jewelry_safe:'safe',product_cabinet:'medicine_cabinet',towel_storage:'storage_cabinet',utility_sink:'shampoo_station',stacked_dryer:'commercial_dryer',laundry_payment:'safe',detergent_vending:'storage_cabinet',consultation_set:'meeting_table'};
 const role=aliases[o.role]||o.role;
 const roles=['jewelry_case','display_plinth','display_table','clothing_rail','plant_display','barber_chair','salon_chair','styling_station','shampoo_station','reception_desk','waiting_bench','bench','commercial_washer','commercial_dryer','folding_table','laundry_cart','jeweler_bench','safe','storage_cabinet','meeting_table','hospital_bed','examination_table','dentist_chair','medical_cart','medicine_cabinet','patient_monitor','iv_stand','privacy_screen','doctor_scale','treadmill','exercise_bench','stock_crate','wheelchair','ultrasound_machine'];
 if(!roles.includes(role))return false;
 const [w,h,d]=o.size_m;
 const mat=(color,extra={})=>new T.MeshStandardMaterial({color,roughness:.6,...extra}),wood=mat(style.wood||'#97785c'),metal=mat('#a9b6b7',{metalness:.55,roughness:.3}),dark=mat('#303d41'),fabric=mat(style.fabric||'#668d89'),white=mat('#e6ece4'),glass=mat('#b3d8d7',{transparent:true,opacity:.3,depthWrite:false});
 const box=(x,y,z,a,b,c,m)=>{const mesh=new T.Mesh(new T.BoxGeometry(a,b,c),m);mesh.position.set(x,y,z);parent.add(mesh);return mesh;};
 const cylinder=(x,y,z,r,height,m,rotate=false)=>{const mesh=new T.Mesh(new T.CylinderGeometry(r,r,height,16),m);if(rotate)mesh.rotation.x=Math.PI/2;mesh.position.set(x,y,z);parent.add(mesh);return mesh;};
 const wheels=()=>{for(const x of[-w*.4,w*.4])for(const z of[-d*.4,d*.4])cylinder(x,.055,z,.055,.04,dark,true);};
 const table=(top=.75)=>{box(0,h*top,0,w,h*.08,d,wood);for(const x of[-w*.42,w*.42])for(const z of[-d*.4,d*.4])box(x,h*top/2,z,.045,h*top,.045,metal);};
 if(/commercial_washer|commercial_dryer/.test(role)){
  box(0,h/2,0,w,h,d,metal);const count=role==='commercial_dryer'?2:1;
  for(let i=0;i<count;i++){const y=h*(count===1?.47:.27+i*.47);cylinder(0,y,d*.505,Math.min(w*.35,h*.20),.04,dark,true);cylinder(0,y,d*.53,Math.min(w*.28,h*.16),.025,glass,true);}
  box(0,h*.91,d*.51,w*.8,h*.11,.025,dark);box(w*.23,h*.91,d*.53,w*.2,h*.045,.02,white);return true;
 }
 if(/barber_chair|salon_chair|dentist_chair/.test(role)){
  cylinder(0,h*.08,0,w*.42,h*.12,metal);cylinder(0,h*.3,0,w*.1,h*.45,metal);box(0,h*.47,0,w*.78,h*.15,d*.68,fabric);box(0,h*.72,-d*.28,w*.8,h*.52,d*.14,fabric);
  for(const x of[-w*.47,w*.47])box(x,h*.59,0,w*.08,h*.08,d*.7,dark);box(0,h*.22,d*.35,w*.65,.045,d*.25,metal);box(0,h*.95,-d*.28,w*.4,h*.1,d*.16,fabric);return true;
 }
 if(/hospital_bed|examination_table/.test(role)){
  wheels();box(0,h*.35,0,w*.9,h*.12,d*.94,metal);box(0,h*.55,0,w*.86,h*.22,d*.85,fabric);box(0,h*.71,-d*.33,w*.65,h*.10,d*.16,white);
  for(const z of[-d*.47,d*.47])box(0,h*.69,z,w,h*.55,.05,white);
  for(const x of[-w*.48,w*.48]){box(x,h*.63,0,.035,h*.36,.035,metal);box(x,h*.81,0,.03,.035,d*.65,metal);}return true;
 }
 if(role==='iv_stand'||role==='patient_monitor'||role==='doctor_scale'){
  wheels();box(0,.06,0,w,.08,d,metal);cylinder(0,h*.48,0,.025,h*.87,metal);
  if(role==='iv_stand'){box(0,h*.96,0,w*.8,.025,.025,metal);box(w*.2,h*.77,0,w*.25,h*.22,.05,glass);}
  else{box(0,h*.84,0,w*.85,h*.28,d*.3,white);box(0,h*.84,d*.17,w*.7,h*.20,.02,dark);box(0,h*.85,d*.185,w*.52,.012,.01,fabric);}return true;
 }
 if(role==='privacy_screen'){for(const x of[-w*.47,0,w*.47]){box(x,h*.48,0,.025,h*.95,.025,metal);box(x,h*.07,0,.04,.04,d,metal);}box(0,h*.58,0,w*.95,h*.75,.025,fabric);return true;}
 if(/styling_station|shampoo_station/.test(role)){
  if(role==='styling_station'&&d>1){box(0,h*.17,-d*.42,w,h*.34,.4,wood);box(0,h*.7,-d*.49,w*.8,h*.5,.04,glass);const chair=new T.Group();chair.position.z=d*.08;parent.add(chair);businessFixture(T,chair,{role:'barber_chair',size_m:[.75,1.2,1.05]},style);return true;}if(role==='styling_station'){box(0,h*.16,0,w,h*.3,d,wood);box(0,h*.67,-d*.4,w*.8,h*.57,.04,glass);box(0,h*.35,0,w,.035,d,white);}
  else{box(0,h*.3,0,w*.75,h*.5,d*.7,dark);box(0,h*.65,-d*.25,w,h*.22,d*.42,white);box(0,h*.73,-d*.25,w*.7,.03,d*.28,dark);}return true;
 }
 if(/jewelry_case|display_plinth|reception_desk|storage_cabinet|medicine_cabinet|safe|stock_crate/.test(role)){
  const vitrine=/jewelry_case|medicine_cabinet/.test(role);box(0,h*.3,0,w,h*.6,d,role==='safe'?dark:wood);
  if(vitrine){box(0,h*.79,0,w,h*.42,d,glass);box(0,h*.59,0,w,.025,d,white);for(const x of[-w*.45,w*.45])box(x,h*.8,-d*.45,.025,h*.4,.025,metal);for(let i=0;i<4;i++)box(w*(i-1.5)*.2,h*.65,0,w*.13,.06,d*.3,fabric);}
  else{box(0,h*.8,0,w,h*.4,d,role==='reception_desk'?white:wood);for(const x of[-w*.2,w*.2])box(x,h*.55,d*.51,.025,.12,.025,metal);}return true;
 }
 if(role==='clothing_rail'){for(const x of[-w*.46,w*.46])box(x,h*.5,0,.035,h,.035,metal);box(0,h*.95,0,w,.035,.035,metal);for(let i=0;i<6;i++)box(w*(i-2.5)*.13,h*.65,0,w*.11,h*.42,d*.55,i%2?fabric:white);return true;}
 if(/waiting_bench|bench/.test(role)){box(0,h*.47,0,w,h*.15,d*.9,fabric);box(0,h*.8,-d*.4,w,h*.38,d*.14,fabric);for(const x of[-w*.4,w*.4])box(x,h*.22,0,.06,h*.44,d*.65,metal);return true;}
 if(role==='treadmill'){box(0,h*.13,0,w,h*.2,d,dark);box(0,h*.24,0,w*.72,.025,d*.8,metal);for(const x of[-w*.42,w*.42])box(x,h*.63,-d*.3,.04,h*.74,.04,metal);box(0,h*.95,-d*.3,w*.8,.08,.25,dark);return true;}
 if(role==='medical_cart'||role==='laundry_cart'){wheels();for(const y of[.16,h*.5,h*.9])box(0,y,0,w,.04,d,metal);for(const x of[-w*.45,w*.45])for(const z of[-d*.45,d*.45])box(x,h*.5,z,.025,h,.025,metal);return true;}
 table(.87);return true;
}
