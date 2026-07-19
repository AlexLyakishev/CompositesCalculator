#imports
import composites_calculator_lib as cc


#Load and display the available materials
materials_list = cc.materials_load()
cc.materials_print(materials_list)


#Create layup
layup_schedule = "0/45/0/45/Zc0.15"
chosen_material = materials_list["Fiberglass_120_7668"]
my_layup = cc.layup_create(layup_schedule, chosen_material)


#Display layup - double check everything is as it should be!
cc.layup_print(my_layup)
h, h_total = cc.layup_calculate_heights(my_layup)
print("Height is " + str(cc.round_sig(h*1000, 6)) + " mm")
print("Total height including core (if present) is " + str(
    cc.round_sig(h_total*1000, 6)) + " mm")


#Run the calculations
A, B, D, = cc.calculate_A_B_D_matrix(my_layup)


#__Generate useful outputs__

# Anisotropic stiffness tensor for use in FEAs
C = cc.generate_anisotropic_stiffness_tensor_C(A, B, D, my_layup)
for row in C:
    print(",".join(f"{x:.6f}" for x in row))