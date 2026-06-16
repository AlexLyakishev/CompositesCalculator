#imports
import composites_calculator_lib as cc


#Load and display the available materials
materials_list = cc.materials_load()
cc.materials_print(materials_list)


#Create layup
layup_schedule = "45/0/0/0/45/t"
chosen_material = materials_list["CF_XC130- C12UD-300(300)"]
my_layup = cc.layup_create(layup_schedule, chosen_material)

cc.layup_material_change(my_layup, 1, materials_list["CF_XC110-C331T2-210(1250)"])
cc.layup_thickness_change(my_layup, 1, 0.00025)
cc.layup_material_change(my_layup, 5, materials_list["CF_XC110-C331T2-210(1250)"])
cc.layup_thickness_change(my_layup, 5, 0.00025)



#Display layup - double check everything is as it should be!
cc.layup_print(my_layup)
h, h_total = cc.layup_calculate_heights(my_layup)
print("Height is " + str(cc.round_sig(h, 6)) + " m")
print("Total height including core (if present) is " + str(
    cc.round_sig(h_total, 6)) + " m")


#Run the calculations
A, B, D, = cc.calculate_A_B_D_matrix(my_layup)


#__Generate useful outputs__

# Anisotropic stiffness tensor for use in FEAs
cc.generate_anisotropic_stiffness_tensor_C(A, B, D, my_layup)

#Rectangular tube bending
inside_height = 0.01 #m
inside_width = 0.01 #m
EY_equivalent = cc.generate_EIeq_rect_tube(A, D, inside_height, inside_width, my_layup)

#Round tube bending
in_dia = 0.03074-2*h #m
print("Inner diameter is " + str(cc.round_sig(in_dia, 6)) + " m")
Dx_equivalent = cc.generate_Dx_eq_circ_tube(A, D, in_dia, my_layup)
Test_Dx = 9.81*600*0.32**3/(48*0.01) #N*m^2
print("Calculated Dx equivalent is " + str(cc.round_sig(Test_Dx, 6)) + " N*m^2")

P = 9.81*600 #N
L = 0.32 #m

midpoint_deflection_mm = P*L**3/(48*Dx_equivalent) *1000 #mm
print("Midpoint deflection under " + str(P) + " N load is " + str(cc.round_sig(midpoint_deflection_mm, 3)) + " mm")

