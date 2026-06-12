#imports
import composites_calculator_lib as cc


#Load and display the available materials
materials_list = cc.materials_load()
cc.materials_print(materials_list)


#Create layup
layup_schedule = "+-45/0/s"
chosen_material = materials_list["Graphite_Epoxy_T300_N5208"]
my_layup = cc.layup_create(layup_schedule, chosen_material)


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
EY_equivalent = cc.generate_EYeq_rect_tube(A, D, inside_height, inside_width, my_layup)

#Round tube bending
in_dia = 0.01 #m
Dx_equivalent = cc.generate_Dx_eq_circ_tube(A, D, in_dia, my_layup)

