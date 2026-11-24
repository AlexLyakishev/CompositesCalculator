# import libraries
import csv
from operator import invert

import pandas as pd
from tabulate import tabulate
import math
import numpy as np

# COMPOSITE CALCULATOR LIBRARY by Alex L
# Version of the whole project (this library, composites_shape_lib and the web calculator), MAJOR.MINOR.PATCH:
# PATCH = bug fix, MINOR = new feature, MAJOR = a change that breaks existing scripts. See CONTRIBUTING.md.
__version__ = "1.3.0"
version = __version__  # older name, kept for scripts that use it
update_date = "2026-11-23"

# TODO: generate_anisotropic_stiffness_tensor_C() uses 6B/h^2 in both off-diagonal blocks, which is inconsistent
# (use 2*sqrt(3)*B/h^2 for a symmetric C, or Tsai's 2B/h^2 / 6B/h^2), and its [A* B*; B* D*] relates in-plane
# strains/curvatures to N/M, so it is not a 3D solid stiffness tensor - for FE shells, pass the raw ABD matrix instead.

if __name__ == "__main__":
    print("This is a library of functions for composite mechanics calculations, based on CLT. It is not meant to be run directly.")
    print("Import this library into your own code and use the functions as needed.")
    print("Version: " + str(version))
    print("Last updated: " + str(update_date))
    print("Created by Alex L.")

# Helper Functions
def round_sig(x, sig=3):
    """
    Round a numeric value to a specific number of significant digits.
    :param x: Number to be rounded.
    :param sig: Number of significant digits.
    :return:
    """
    if isinstance(x, (int, float, np.floating, np.integer)):
        return float(f"{x:.{sig}g}")
    return x  # leave strings/None unchanged


# make material class
class Material:
    def __init__(self, name: str, modulus_params: list, strength_params: list,
                 thickness: float,
                 density: float,
                 source: str):
        self.name = name

        # Mpa
        self.Ex = modulus_params[0]
        self.Ey = modulus_params[1]
        self.Es = modulus_params[2]

        # Unitless
        self.vxy = modulus_params[3]

        # Mpa
        self.Xt = strength_params[0]
        self.Xc = strength_params[1]
        self.Yt = strength_params[2]
        self.Yc = strength_params[3]
        self.Sc = strength_params[4]

        # m
        self.h0 = thickness

        # kg/m^3
        self.rho = density

        self.source = source


    def __str__(self):
        table = pd.DataFrame({
            "Modulus": ["Ex (GPa)", "Ey (GPa)", "Es (GPa)", "Vxy", None],
            "": [self.Ex, self.Ey, self.Es, self.vxy, ""],
            "Strength": ["Xt (MPa)", "Xc (MPa)", "Yt (MPa)", "Yc (MPa)",
                         "Sc (MPa)"],
            " ": [self.Xt, self.Xc, self.Yt, self.Yc, self.Sc],
            "Other": ["h0 (m)", "rho (kg/m^3)", "Source", "", ""],
            "  ": [self.h0, self.rho, self.source, "", ""],
        })
        print(self.name)
        print(tabulate(table, headers='keys', tablefmt='psql'))
        return ""


class Layer:
    def __init__(self, material: Material, ply_thickness: float,
                 ply_orientation: float):
        self.material = material
        self.ply_thickness = ply_thickness
        self.ply_orientation = ply_orientation

    def __str__(self):
        return str(self.material.name) + " " + str(
            self.ply_thickness) + " " + str(self.ply_orientation)


# load and display materials from csv database
def materials_load(csv_path="materials_database.csv"):
    """
    Import all materials from a csv file. Must have the columns format name,Ex,Ey,Es,vxy,Xt,Xc,Yt,Yc,Sc,h0,rho.
    Units GPa for modulus Ex,Ey,Es, MPa for strengths, Layer height in m, density in kg/m^3

    :param csv_path: the path to csv file containing material information
    :return: list of Material objects. Use materials_print() to view.
    """
    materials_list = {}

    with open(csv_path, newline="") as f:
        reader = csv.DictReader(f)

        for row in reader:
            materials_list[row["name"]] = Material(
                row["name"],
                [
                    float(row["Ex"]),
                    float(row["Ey"]),
                    float(row["Es"]),
                    float(row["vxy"])
                ],
                [
                    float(row["Xt"]),
                    float(row["Xc"]),
                    float(row["Yt"]),
                    float(row["Yc"]),
                    float(row["Sc"])
                ],
                float(row["h0"]),
                float(row["rho"]),
                str(row["Source"])
            )

    return materials_list

def materials_print(materials_list):
    """
    Display materials information to user. Input is output of materials_load()

    :param materials_list: output of materials_load()
    :return:
    """
    for mat in materials_list:
        print(materials_list[mat])


# create and display layup
def layup_create(template: str, my_material: Material):
    """
    Create a dataframe with each layer of a layup

    :param template: string of the layup schedule
    :param my_material: material for every layer. Run layup_material_change() AFTER this for multimaterial layup
    :return: layup dataframe, h: height of plies, h_total: height including core
    """
    layup = []
    Zc = 0.0
    has_core = False

    tokens = template.split("/")

    # logic for working with different types of layups i.e. symmetric or total
    layup_type = tokens[-1]

    if layup_type == "s" or layup_type == "t" or layup_type == "so":
        layup_type = tokens.pop()
    else:
        layup_type = "s"
    # print(layup_type)

    # Process tokens
    for t in tokens:
        t = t.strip().lower()

        if t.startswith("zc"):
            # Core thickness in cm
            has_core = True
            Zc = float(t.replace("zc", ""))
            core = Material("Core", [0.1, 0.1, 0.1, 0.1], [0.1, 0.1, 0.1, 0.1, 0.1], Zc * 0.01, 0, "N/A")
            layup.append(
                Layer(core, Zc * 0.01, 0))  # treated as just another layer

        elif t.startswith("+-"):
            # woven layer at +- theta. NOTE by definition woven is 2 directions at 90 degree difference
            theta = float(t.replace("+-", ""))
            theta2 = theta - 90
            thickness = my_material.h0 / 4
            layup.append(Layer(my_material, thickness, theta))
            layup.append(Layer(my_material, thickness, theta2))
            layup.append(Layer(my_material, thickness, theta))
            layup.append(Layer(my_material, thickness, theta2))

        else:
            orientation = float(t)
            thickness = my_material.h0
            layup.append(Layer(my_material, thickness, orientation))

    # Build symmetric layup (core included). If total, just skips this step
    if layup_type == "so":
        back = layup[::-1]
        layup = layup + back[1:]
    elif layup_type == "s":
        back = layup[::-1]
        layup = layup + back

    # Convert layup into dataframe
    data = []
    counter = 1
    h = 0.0
    h_total = 0.0

    for a in layup:
        if a.material.name == "Core":
            data.append({
                "Layer #": "N/A",
                "Material_name": a.material.name,
                "Material": a.material,
                "Thickness (m)": a.ply_thickness,
                "Orientation (deg)": 0,
            })
            h_total += a.ply_thickness
        else:
            data.append({
                "Layer #": counter,
                "Material_name": a.material.name,
                "Material": a.material,
                "Thickness (m)": a.ply_thickness,
                "Orientation (deg)": a.ply_orientation,
            })
            h += a.ply_thickness
            h_total += a.ply_thickness
            counter += 1

    lu = pd.DataFrame(data)
    return lu

def layup_print(layup_dataframe):
    """
    Prints out a table with the current layup

    :param layup_dataframe: output of layup_create()
    :param h: height of the composite plies, from layup_create()
    :param h_total: total heigh including core, from layup_create()
    :return:
    """
    print("\nThe current layup is:")
    print(tabulate(layup_dataframe.drop(columns=["Material"]), headers="keys", tablefmt="psql"))
    print()

def layup_calculate_heights(lu: pd.DataFrame):
    """
    Calculate height h of all plies, as well as the total height h_total that includes core (if present)
    :param lu: layup_dataframe: output of layup_create()
    :return: h, h_total
    """
    h_inner = lu[lu["Material_name"] != "Core"]["Thickness (m)"].sum()
    h_total_inner = lu["Thickness (m)"].sum()

    return h_inner, h_total_inner

def layup_material_change(lu: pd.DataFrame, layer_num:int, new_material: Material):
    """
    Changes the material of a single layer in a layup.

    :param lu: layup dataframe, output of layup_create()
    :param layer_num: int number of the layer you want to change. Matching layup_print()
    :param new_material: Material object of the new material
    :return: nothing, changes dataframe in place
    """
    #print(new_material.name)
    lu.loc[lu["Layer #"] == layer_num, "Material_name"] = new_material.name
    lu.loc[lu["Layer #"] == layer_num, "Material"] = new_material

def layup_thickness_change(lu: pd.DataFrame, layer_num:int, new_thickness: float):
    """
    Changes the thickness of a single layer in a layup.

    :param lu: layup dataframe, output of layup_create()
    :param layer_num: int number of the layer you want to change. Matching layup_print()
    :param new_thickness: New thickness of layer in m
    :return: nothing, changes dataframe in place
    """
    lu.loc[lu["Layer #"] == layer_num, "Thickness (m)"] = new_thickness

def layup_orientation_change(lu: pd.DataFrame, layer_num:int, new_orientation: float):
    """
    Changes the orientation of a single layer in a layup.

    :param lu: layup dataframe, output of layup_create()
    :param layer_num: int number of the layer you want to change. Matching layup_print()
    :param new_orientation: New orientation of layer in m
    :return: nothing, changes dataframe in place
    """
    lu.loc[lu["Layer #"] == layer_num, "Orientation (deg)"] = new_orientation


# Calculate matrix's for each layer
def _s_q_matrix(layer):
    """
    Private function, calculates the S and Q matrixes for a layer
    :param layer: row of layup matrix
    :return: S and Q matrix
    """
    my_material = layer["Material"]
    # print(my_material)

    vx = my_material.vxy
    vy = vx / (my_material.Ex / my_material.Ey)
    vz = 1
    m = (1 - vx * vy) ** (-1)

    # s_matrix = pd.DataFrame({
    #     "all units 1/GPa": ["εx", "εy", "εs"],
    #     "σx": [1 / my_material.Ex, -vx / my_material.Ex, 0],
    #     "σy": [-vy / my_material.Ey, 1 / my_material.Ey, 0],
    #     "σs": [0, 0, 1 / my_material.Es],
    # })

    s_matrix = np.array([
        [1 / my_material.Ex, -vx / my_material.Ex, 0],
        [-vy / my_material.Ey, 1 / my_material.Ey, 0],
        [0, 0, 1 / my_material.Es]
    ])

    # q_matrix = pd.DataFrame({
    #     "all units GPa": ["σx", "σy", "σs"],
    #     "εx": [m * my_material.Ex, m * vy * my_material.Ex, 0],
    #     "εy": [m * vy * my_material.Ex, m * vz * my_material.Ey, 0],
    #     "εs": [0, 0, my_material.Es],
    # })

    q_matrix = np.array([
        [m * my_material.Ex, m * vy * my_material.Ex, 0],
        [m * vy * my_material.Ex, m * vz * my_material.Ey, 0],
        [0, 0, my_material.Es]
    ])

    # Apply rounding to all numeric entries
    # s_matrix = s_matrix.map(round_sig)
    # q_matrix = q_matrix.map(round_sig)

    return s_matrix, q_matrix

def _s_q_matrix_off_axis(layer):
    #S off-axis
    S = layer["S matrix"]
    ply_angle = layer["Orientation (deg)"]

    Sxx = S[0, 0]
    Syy = S[1, 1]
    Sxy = S[1, 0]
    Sss = S[2, 2]

    U1 = round_sig((1.0 / 8.0) * (3 * Sxx + 3 * Syy + 2 * Sxy + Sss), 6)
    U2 = round_sig(0.5 * (Sxx - Syy), 6)
    U3 = round_sig((1.0 / 8.0) * (Sxx + Syy - 2 * Sxy - Sss), 6)
    U4 = round_sig((1.0 / 8.0) * (Sxx + Syy + 6 * Sxy - Sss), 6)
    U5 = round_sig(0.5 * (Sxx + Syy - 2 * Sxy + Sss), 6)

    S_compliance_relations = np.array([[U1, round_sig(
        math.cos(math.radians(2 * ply_angle)), 6), round_sig(
        math.cos(math.radians(4 * ply_angle)), 6)],
                                       [U1, -1 * round_sig(math.cos(
                                           math.radians(2 * ply_angle)), 6),
                                        round_sig(math.cos(
                                            math.radians(4 * ply_angle)), 6)],
                                       [U4, 0, -1 * round_sig(math.cos(
                                           math.radians(4 * ply_angle)), 6)],
                                       [U5, 0, -4 * round_sig(math.cos(
                                           math.radians(4 * ply_angle)), 6)],
                                       [0, round_sig(math.sin(
                                           math.radians(2 * ply_angle)), 6),
                                        2 * round_sig(math.sin(
                                            math.radians(4 * ply_angle)), 6)],
                                       [0, round_sig(math.sin(
                                           math.radians(2 * ply_angle)), 6),
                                        -2 * round_sig(math.sin(
                                            math.radians(4 * ply_angle)), 6)]])

    vector = np.array([1, U2, U3])

    S_off_axis_vector = S_compliance_relations @ vector

    s_matrix_off = np.array([
        [S_off_axis_vector[0], S_off_axis_vector[2], S_off_axis_vector[4]],
        [S_off_axis_vector[2], S_off_axis_vector[1], S_off_axis_vector[5]],
        [S_off_axis_vector[4], S_off_axis_vector[5], S_off_axis_vector[3]]
    ])

    # Q off-axis
    Q = layer["Q matrix"]
    # ply angle is the same as for S

    Qxx = Q[0, 0]
    Qyy = Q[1, 1]
    Qxy = Q[1, 0]
    Qss = Q[2, 2]

    U1 = round_sig(0.125 * (3.0 * Qxx + 3.0 * Qyy + 2.0 * Qxy + 4.0 * Qss), 6)
    U2 = round_sig(0.5 * (Qxx - Qyy), 6)
    U3 = round_sig((1.0 / 8.0) * (Qxx + Qyy - 2.0 * Qxy - 4.0 * Qss), 6)
    U4 = round_sig((1.0 / 8.0) * (Qxx + Qyy + 6.0 * Qxy - 4.0 * Qss), 6)
    U5 = round_sig((1.0 / 8.0) * (Qxx + Qyy - 2.0 * Qxy + 4.0 * Qss), 6)

    Q_modulus_relations = np.array([[U1, round_sig(
        math.cos(math.radians(2 * ply_angle)), 6), round_sig(
        math.cos(math.radians(4 * ply_angle)), 6)],
                                    [U1, -1.0 * round_sig(
                                        math.cos(math.radians(2 * ply_angle)),
                                        6), round_sig(
                                        math.cos(math.radians(4 * ply_angle)),
                                        6)],
                                    [U4, 0, -1.0 * round_sig(
                                        math.cos(math.radians(4 * ply_angle)),
                                        6)],
                                    [U5, 0, -1.0 * round_sig(
                                        math.cos(math.radians(4 * ply_angle)),
                                        6)],
                                    [0, 0.5 * round_sig(
                                        math.sin(math.radians(2 * ply_angle)),
                                        6), round_sig(
                                        math.sin(math.radians(4 * ply_angle)),
                                        6)],
                                    [0, 0.5 * round_sig(
                                        math.sin(math.radians(2 * ply_angle)),
                                        6), -1.0 * round_sig(
                                        math.sin(math.radians(4 * ply_angle)),
                                        6)]])

    vector = np.array([1.0, U2, U3])

    Q_off_axis_vector = Q_modulus_relations @ vector

    q_matrix_off = np.array([
        [Q_off_axis_vector[0], Q_off_axis_vector[2], Q_off_axis_vector[4]],
        [Q_off_axis_vector[2], Q_off_axis_vector[1], Q_off_axis_vector[5]],
        [Q_off_axis_vector[4], Q_off_axis_vector[5], Q_off_axis_vector[3]]
    ])

    return s_matrix_off, q_matrix_off

def calculate_A_B_D_matrix(lu: pd.DataFrame):
    """
    Calculates the s and q matrix of each layer in a layup. Appends to the same dataframe.
    :param lu: layup dataframe, output of layup_create()
    :return: A_matrix [GPa*m or 10^9*N/m], B_matrix [N or Nm/m], D_matrix [Nm]
    """
    # S and Q matrix
    lu[["S matrix", "Q matrix"]] = lu.apply(_s_q_matrix, axis=1, result_type="expand")
    lu[["S matrix off", "Q matrix off"]] = lu.apply(_s_q_matrix_off_axis, axis=1, result_type="expand")

    # A matrix
    Q11 = np.array([Q[0, 0] for Q in lu["Q matrix off"]])
    A11 = np.sum(lu["Thickness (m)"].to_numpy() * Q11)
    Q22 = np.array([Q[1, 1] for Q in lu["Q matrix off"]])
    A22 = np.sum(lu["Thickness (m)"].to_numpy() * Q22)
    Q12 = np.array([Q[0, 1] for Q in lu["Q matrix off"]])
    A12 = np.sum(lu["Thickness (m)"].to_numpy() * Q12)
    Q66 = np.array([Q[2, 2] for Q in lu["Q matrix off"]])
    A66 = np.sum(lu["Thickness (m)"].to_numpy() * Q66)
    Q16 = np.array([Q[0, 2] for Q in lu["Q matrix off"]])
    A16 = np.sum(lu["Thickness (m)"].to_numpy() * Q16)
    Q26 = np.array([Q[1, 2] for Q in lu["Q matrix off"]])
    A26 = np.sum(lu["Thickness (m)"].to_numpy() * Q26)

    A_matrix = np.array([
        [A11, A12, A16],
        [A12, A22, A26],
        [A16, A26 , A66]
    ])


    # Finding layer distances from midplane for B and D matrix
    h = lu["Thickness (m)"].sum()
    midpoint = h / 2.0

    lu["BottomHeight"] = lu["Thickness (m)"].cumsum()
    lu["BottomHeight"] -= midpoint
    lu["BottomHeight"] *= -1.0

    lu["TopHeight"] = lu["Thickness (m)"].cumsum().shift(1, fill_value=0)
    lu["TopHeight"] -= midpoint
    lu["TopHeight"] *= -1.0

    B11 = np.sum((lu["TopHeight"].to_numpy()**2-lu["BottomHeight"].to_numpy()**2) * Q11)
    B12 = np.sum((lu["TopHeight"].to_numpy()**2-lu["BottomHeight"].to_numpy()**2) * Q12)
    B16 = np.sum((lu["TopHeight"].to_numpy()**2-lu["BottomHeight"].to_numpy()**2) * Q16)
    B22 = np.sum((lu["TopHeight"].to_numpy()**2-lu["BottomHeight"].to_numpy()**2) * Q22)
    B26 = np.sum((lu["TopHeight"].to_numpy()**2-lu["BottomHeight"].to_numpy()**2) * Q26)
    B66 = np.sum((lu["TopHeight"].to_numpy()**2-lu["BottomHeight"].to_numpy()**2) * Q66)

    B_matrix = np.array([
        [B11, B12, B16],
        [B12, B22, B26],
        [B16, B26 , B66]
    ])
    B_matrix *= 1/2
    B_matrix *= 10**9


    D11 = np.sum((lu["TopHeight"].to_numpy() ** 3 - lu["BottomHeight"].to_numpy() ** 3) * Q11)
    D12 = np.sum((lu["TopHeight"].to_numpy() ** 3 - lu["BottomHeight"].to_numpy() ** 3) * Q12)
    D16 = np.sum((lu["TopHeight"].to_numpy() ** 3 - lu["BottomHeight"].to_numpy() ** 3) * Q16)
    D22 = np.sum((lu["TopHeight"].to_numpy() ** 3 - lu["BottomHeight"].to_numpy() ** 3) * Q22)
    D26 = np.sum((lu["TopHeight"].to_numpy() ** 3 - lu["BottomHeight"].to_numpy() ** 3) * Q26)
    D66 = np.sum((lu["TopHeight"].to_numpy() ** 3 - lu["BottomHeight"].to_numpy() ** 3) * Q66)

    D_matrix = np.array([
        [D11, D12, D16],
        [D12, D22, D26],
        [D16, D26, D66]
    ])
    D_matrix *= 1/3
    D_matrix *= 10**9

    # print(A_matrix)
    # print(B_matrix)
    # print(D_matrix)

    return A_matrix, B_matrix, D_matrix


#Generate useful quantities
def generate_anisotropic_stiffness_tensor_C(A_matrix, B_matrix, D_matrix, lu: pd.DataFrame):
    """
    Generates the equivalent anisotropic stiffness tensor for a layup with units of GPa.
    calculate_A_B_D_matrix() must be run prior to calling this function.

    :param A_matrix: A_matrix [GPa*m or 10^9*N/m], from calculate_A_B_D_matrix()
    :param B_matrix:  B_matrix [Nm/m]
    :param D_matrix: D_matrix [Nm]
    :param lu: layup dataframe, output of layup_create()
    :return: C_matrix [GPa]
    """
    h = lu["Thickness (m)"].sum()

    A_matrix = A_matrix * 1/h
    B_matrix = B_matrix * (6/(h**2)) * 1/(10**9)
    D_matrix = D_matrix * 12/h**3 * 1/(10**9)

    C_matrix = np.block([
        [A_matrix, B_matrix],
        [B_matrix, D_matrix]
    ])
    print()
    print("C_matrix, units GPa")
    print(C_matrix)

    return C_matrix

def generate_EIeq_rect_tube(A_matrix, D_matrix, in_height, in_width, lu: pd.DataFrame):
    """
    Calculates the E*Y equivalent value [N*m^2] for a composite rectangular tube. Assumes layup is symmetric.
    EYeq can be used in beam theory calculations.
    calculate_A_B_D_matrix() must be run prior to calling this function.

    :param A_matrix: A_matrix [GPa*m or 10^9*N/m], from calculate_A_B_D_matrix()
    :param D_matrix: D_matrix [Nm]
    :param in_height: The inside height of the tube [m]
    :param in_width: The inside width of the tube [m]
    :param lu: layup dataframe, output of layup_create()
    :return: the E*I equivalent for the tube [N*m^2]
    """
    h = lu["Thickness (m)"].sum()

    w_sq_tube = in_width + 2*h
    h_sq_tube = in_height + h
    l_sq_tube = in_height

    EI_eq = 2 * (w_sq_tube * D_matrix[0][0] + ((h_sq_tube / 2) ** 2) * w_sq_tube * A_matrix[0][0] * 10 ** 9) + 2 * (
                ((l_sq_tube ** 3) / 12) * A_matrix[0][0] * 10 ** 9)

    print("EI equivalent [N*m^2] is ", EI_eq)
    return EI_eq

def generate_Dx_eq_circ_tube(A_matrix, D_matrix, inner_diameter, lu: pd.DataFrame):
    """
    Calculates the E*I equivalent value [N*m^2] for a composite circular tube. Assumes layup is symmetric.
    EYeq can be used in beam theory calculations.
    calculate_A_B_D_matrix() must be run prior to calling this function.

    :param A_matrix: A_matrix [GPa*m or 10^9*N/m], from calculate_A_B_D_matrix()
    :param D_matrix: D_matrix [Nm]
    :param inner_diameter: The inside diameter of the tube [m]
    :param lu: layup dataframe, output of layup_create()
    :return: the Dx equivalent for the tube [N*m^2]
    """
    h = lu["Thickness (m)"].sum()

    half_h = h / 2
    InsideRadius_round = inner_diameter / 2

    # core takes up space but carries no bending load
    lu_roundtube = lu[lu["Material"].apply(lambda m: m.name != "Core")].copy()

    lu_roundtube["off_axis_q11"] = np.array([Q[0, 0] for Q in lu_roundtube["Q matrix off"]])

    lu_roundtube["tk"] = lu_roundtube.apply(
        lambda row:
        row["TopHeight"] + half_h  # <-- single value from that row
        ,
        axis=1
    )

    lu_roundtube["tk-1"] = lu_roundtube.apply(
        lambda row:
        row["BottomHeight"] + half_h  # <-- single value from that row
        ,
        axis=1
    )

    lu_roundtube["Ds"] = lu_roundtube.apply(
        lambda row:
        row["off_axis_q11"] * 10 ** 9 * (
                    (InsideRadius_round + row["tk"]) ** 4 - (InsideRadius_round + row["tk-1"]) ** 4)
        ,
        axis=1
    )

    Dx_eq = (np.pi / 4) * lu_roundtube["Ds"].sum()

    print("Dx equivalent [N*m^2] is ", Dx_eq)
    return Dx_eq

# Cross-section geometry helpers, used by generate_EIeq_arbitrary_tube() and generate_torsion_arbitrary_tube()
def _section_read_csv(csv_path, surface):
    """
    Reads a tube cross-section outline from a CSV of points (columns x2,x3 [m] or theta_deg,r [deg, m]),
    removes repeated points, checks the outline does not cross itself and makes it counter-clockwise.
    :return: px, py vertices of the outline [m]
    """
    if surface not in ("inner", "outer"):
        raise ValueError("surface must be 'inner' or 'outer', got " + repr(surface))

    pts = pd.read_csv(csv_path)
    pts.columns = [c.strip().lower() for c in pts.columns]

    if {"x2", "x3"}.issubset(pts.columns):
        px = pts["x2"].to_numpy(dtype=float)
        py = pts["x3"].to_numpy(dtype=float)
    elif {"theta_deg", "r"}.issubset(pts.columns):
        theta_pts = np.radians(pts["theta_deg"].to_numpy(dtype=float))
        r_pts = pts["r"].to_numpy(dtype=float)
        px, py = r_pts * np.cos(theta_pts), r_pts * np.sin(theta_pts)
    else:
        raise ValueError("CSV must have columns 'x2,x3' or 'theta_deg,r', found: " + ", ".join(pts.columns))

    # remove repeated consecutive points (including a repeated closing point)
    keep = np.hypot(np.roll(px, -1) - px, np.roll(py, -1) - py) > 1e-12
    px, py = px[keep], py[keep]
    if len(px) < 3:
        raise ValueError("At least 3 distinct points are needed to define a cross-section")

    # check the outline does not cross itself (usually means the points are out of order)
    if len(px) <= 2000:
        ax, ay = px[:, None], py[:, None]
        bx, by = np.roll(px, -1)[:, None], np.roll(py, -1)[:, None]

        def side(ox, oy, ex, ey, qx, qy):
            return (ex - ox) * (qy - oy) - (ey - oy) * (qx - ox)

        d1 = side(ax, ay, bx, by, ax.T, ay.T)
        d2 = side(ax, ay, bx, by, bx.T, by.T)
        d3 = side(ax.T, ay.T, bx.T, by.T, ax, ay)
        d4 = side(ax.T, ay.T, bx.T, by.T, bx, by)
        if np.any((d1 * d2 < 0) & (d3 * d4 < 0)):
            raise ValueError("Cross-section outline crosses itself; check the points are in order around the section")

    print("Loaded " + str(len(px)) + " cross-section points (" + surface + " surface) from " + str(csv_path))

    # make the outline counter-clockwise so the normals point outward
    if np.sum(px * np.roll(py, -1) - np.roll(px, -1) * py) < 0:
        px, py = px[::-1], py[::-1]
    return px, py


def _section_polygon_moments(x, y):
    """
    Area integrals of the region enclosed by a closed counter-clockwise polygon (Green's theorem).
    :return: array of int dA, int x2 dA, int x3 dA, int x2^2 dA, int x3^2 dA, int x2*x3 dA
    """
    x1, y1 = np.roll(x, -1), np.roll(y, -1)
    c = x * y1 - x1 * y
    return np.array([
        np.sum(c) / 2,
        np.sum(c * (x + x1)) / 6,
        np.sum(c * (y + y1)) / 6,
        np.sum(c * (x ** 2 + x * x1 + x1 ** 2)) / 12,
        np.sum(c * (y ** 2 + y * y1 + y1 ** 2)) / 12,
        np.sum(c * (x * y1 + 2 * x * y + 2 * x1 * y1 + x1 * y)) / 24,
    ])


def _section_offset(px, py, d, max_arc_step=np.radians(1.0)):
    """
    Offsets a closed counter-clockwise polygon by a constant normal distance d (d > 0 outward, d < 0 inward),
    the way plies laid up on it would sit. Corners the plies wrap around get an arc of radius |d|. At the
    other corners the two offset edges meet at a point, and edges too short to survive the offset are
    removed, so e.g. at a sharp trailing edge the inner boundary ends where the top and bottom skins meet.
    :return: x2, x3 vertices of the offset polygon (empty if the offset closes up completely)
    """
    if d == 0:
        return px, py
    sx, sy = px, py  # edge k runs from vertex k to vertex k+1
    tx, ty = np.roll(px, -1) - px, np.roll(py, -1) - py
    length = np.hypot(tx, ty)
    tx, ty = tx / length, ty / length
    nx, ny = ty, -tx  # outward normal of edge k (counter-clockwise polygon)
    c = nx * sx + ny * sy + d  # offset line of edge k: nx*x2 + ny*x3 = c

    active = np.arange(len(px))
    while True:
        if len(active) < 3:
            return np.array([]), np.array([])
        k, p = active, np.roll(active, 1)  # each active edge and the active edge before it
        cross = nx[p] * ny[k] - ny[p] * nx[k]
        dot = nx[p] * nx[k] + ny[p] * ny[k]
        turn = np.arctan2(cross, dot)  # >0: convex corner at the start of edge k
        wrap = turn * d > 1e-12 * abs(d)  # plies wrap around this corner on an arc

        # where each edge starts: on an arc corner its own offset point, otherwise where the offset lines meet
        base_x, base_y = sx[k] + d * nx[k], sy[k] + d * ny[k]
        solvable = np.abs(cross) > 1e-12
        safe_cross = np.where(solvable, cross, 1.0)
        meet_x = np.where(solvable, (c[p] * ny[k] - ny[p] * c[k]) / safe_cross, base_x)
        meet_y = np.where(solvable, (nx[p] * c[k] - c[p] * nx[k]) / safe_cross, base_y)
        start_x, start_y = np.where(wrap, base_x, meet_x), np.where(wrap, base_y, meet_y)
        # where each edge ends: the start of the next edge, or its own offset end point before an arc
        wrap_next = np.roll(wrap, -1)
        end_x = np.where(wrap_next, sx[k] + length[k] * tx[k] + d * nx[k], np.roll(meet_x, -1))
        end_y = np.where(wrap_next, sy[k] + length[k] * ty[k] + d * ny[k], np.roll(meet_y, -1))

        # an edge whose offset runs backwards has been consumed by its neighbours
        s = (end_x - start_x) * tx[k] + (end_y - start_y) * ty[k]
        folded = ~wrap & ~solvable & (dot < 0)  # offset lines anti-parallel: they never meet
        bad = (s <= 0) | folded | np.roll(folded, -1)
        if not bad.any():
            break
        # remove the worst edge of each run of bad edges, then recheck
        s_prev, s_next = np.roll(s, 1), np.roll(s, -1)
        bad_prev, bad_next = np.roll(bad, 1), np.roll(bad, -1)
        remove = bad & (~bad_prev | (s <= s_prev)) & (~bad_next | (s < s_next))
        if not remove.any():
            remove = bad
        active = active[~remove]

    out_x, out_y = [], []
    for i in range(len(k)):
        if wrap[i]:
            a0 = np.arctan2(ny[p[i]], nx[p[i]])
            a = np.linspace(a0, a0 + turn[i], int(np.ceil(abs(turn[i]) / max_arc_step)) + 1)
            out_x.extend(sx[k[i]] + d * np.cos(a))
            out_y.extend(sy[k[i]] + d * np.sin(a))
        else:
            out_x.append(start_x[i])
            out_y.append(start_y[i])
    return np.array(out_x), np.array(out_y)


def _section_checked_offset(px, py, d, surface, h):
    """
    _section_offset(), plus a check that the offset did not fold over itself, which happens when two separate
    parts of the wall are closer than twice the offset. Every point of a valid offset is exactly |d| from the
    outline (px, py); a point closer than that means it folded.
    :param surface: "inner" or "outer", for the error message
    :param h: total layup thickness [m], for the error message
    :return: x2, x3 vertices of the offset polygon (empty if the offset closes up completely)
    """
    ox, oy = _section_offset(px, py, d)
    if d == 0 or len(ox) == 0:
        return ox, oy

    ex, ey = np.roll(px, -1) - px, np.roll(py, -1) - py
    len2 = ex ** 2 + ey ** 2
    gap = np.empty(len(ox))
    for i in range(0, len(ox), 500):  # distance from each offset point to the outline, in chunks to limit memory
        wx = ox[i:i + 500, None] - px[None, :]
        wy = oy[i:i + 500, None] - py[None, :]
        s = np.clip((wx * ex + wy * ey) / len2, 0, 1)
        gap[i:i + 500] = np.sqrt(np.min((wx - s * ex) ** 2 + (wy - s * ey) ** 2, axis=1))

    worst = np.argmin(gap)
    if gap[worst] < abs(d) * (1 - 1e-6):
        where = "(" + str(round_sig(ox[worst], 4)) + ", " + str(round_sig(oy[worst], 4)) + ") m"
        if surface == "outer":
            hint = ("Opposite walls are closer than twice the layup thickness there, so the hollow "
                    "would split in two: widen the gap in the outline, or use a thinner layup.")
        else:
            hint = ("Separate parts of the inner surface are closer than twice the layup thickness "
                    "there, so the outer surfaces would overlap: widen the gap, or use a thinner layup.")
        raise ValueError("Layup (" + str(round_sig(h * 1000)) + " mm) is too thick for the shape near " +
                         where + ". " + hint)
    return ox, oy


def generate_EIeq_arbitrary_tube(csv_path, lu: pd.DataFrame, surface="inner"):
    """
    Calculates the bending stiffness [N*m^2] of a composite tube with an arbitrary cross-section, symmetric or
    not (e.g. an airfoil), with the cross-section outline read from a CSV of points. Based on MECH530 Lecture 21,
    "Composite Tube Bending - Arbitrary Symmetric Cross-section", extended to unsymmetric sections.
    Assumes the layup is symmetric. calculate_A_B_D_matrix() must be run prior to calling this function.

    The CSV needs a header row with one of these column pairs (case-insensitive):
        x2,x3          Cartesian points on the surface [m]
        theta_deg,r    polar points: angle from the +x2 axis toward +x3 [degrees] and radius [m]

    The points can use any origin; stiffness is always calculated about the section's neutral axis. Points must
    be listed in order around the section (either direction). The shape is closed automatically, so do not repeat
    the first point at the end (doing so is harmless). Consecutive points are joined by straight lines (the
    lecture's "linear segments" approximation), so a polygon such as a rectangle is exact from its corners alone,
    and a curved shape needs enough points to follow the curve. The outline must not cross itself.

    surface="inner": the points are the inner surface and the layup is built outward from it (e.g. a tube
                     made on a mandrel). Convex corners of the outer surface become rounded.
    surface="outer": the points are the outer surface and the layup is built inward from it (e.g. an airfoil
                     made in a female mould). Concave corners of the inner surface become rounded.
    In both cases layer 1 is the outermost ply, as in generate_Dx_eq_circ_tube(). Where the section is thinner
    than twice the layup thickness, such as at a sharp trailing edge, the plies from the two walls meet and fill
    it solid: each point belongs to the ply at its depth below the nearest surface. An error is raised only if
    two separate parts of the wall are closer than twice the layup thickness, i.e. the hollow would split in two
    ("outer") or the outer surfaces would overlap ("inner").

    Every layer has a constant thickness measured normal to the wall, as a real layup does. (The lecture
    instead stacks layers radially, r = r0(theta) + t, which makes flat walls too thin away from the axes; the
    two agree exactly for a circle.) With Q11_i the axial stiffness of layer i and (x2c, x3c) the
    stiffness-weighted centroid (where the neutral axis passes, so the lecture's e1 term is zero):

        EA                                   = sum_i Q11_i * int_layer dA
        EI_2  (moment 3M1, bending about x2) = sum_i Q11_i * int_layer (x3 - x3c)^2 dA
        EI_3  (moment 2M1, bending about x3) = sum_i Q11_i * int_layer (x2 - x2c)^2 dA
        EI_23 (coupling)                     = sum_i Q11_i * int_layer (x2 - x2c)(x3 - x3c) dA

    EI_23 is zero for a section symmetric about x2 or x3. When it is not zero, bending about x2 also
    deflects the beam in the x2 direction; use the principal values EI_max and EI_min, whose axes are rotated
    by principal_angle_deg, or the full [[EI_3, EI_23], [EI_23, EI_2]] matrix in beam calculations.
    Each layer boundary is the surface outline offset by its distance through the layup, and the area integrals
    are done exactly on the offset outlines. For a circle EI_2 and EI_3 equal generate_Dx_eq_circ_tube().

    :param csv_path: path to the CSV file of surface points
    :param lu: layup dataframe, output of layup_create()
    :param surface: "inner" if the points are the inner surface of the tube, "outer" if they are the outer surface
    :return: dict with
        "EI_2", "EI_3", "EI_23": bending stiffnesses about the x2 and x3 axes through the centroid [N*m^2]
        "EI_max", "EI_min": principal bending stiffnesses [N*m^2]
        "principal_angle_deg": angle of the EI_max axis, from +x2 toward +x3 [degrees]. 0 for a symmetric section
                               whose stiffest bending is about x2, 90 if it is about x3
        "centroid": (x2c, x3c), the stiffness-weighted centroid in the CSV's coordinates [m]
        "EA": axial stiffness [N]
    """
    px, py = _section_read_csv(csv_path, surface)

    # Area integrals of each layer boundary, keyed by its offset from the surface in the CSV
    h = lu["Thickness (m)"].sum()
    half_h = h / 2
    moments = {}

    def boundary_moments(d):
        d = round(float(d), 15)
        if d not in moments:
            ox, oy = _section_checked_offset(px, py, d, surface, h)
            if len(ox) == 0:
                moments[d] = np.zeros(6)  # the hollow has closed up completely at this depth
                return moments[d]
            moments[d] = _section_polygon_moments(ox, oy)
        return moments[d]

    # Sum each layer's contribution about the CSV origin
    totals = np.zeros(6)  # EA, sum Q*int x2, sum Q*int x3, sum Q*int x2^2, sum Q*int x3^2, sum Q*int x2*x3
    for _, row in lu.iterrows():
        if row["Material"].name == "Core":
            continue  # core takes up space but carries no bending load
        q11 = row["Q matrix off"][0, 0] * 10 ** 9  # [Pa]
        # distances of the layer's outer and inner faces from the inner surface
        d_hi = row["TopHeight"] + half_h
        d_lo = row["BottomHeight"] + half_h
        if surface == "outer":
            d_hi, d_lo = d_hi - h, d_lo - h  # measured inward from the outer surface instead
        totals += q11 * (boundary_moments(d_hi) - boundary_moments(d_lo))

    # Move to the stiffness-weighted centroid (parallel axis theorem)
    EA = totals[0]
    x2c, x3c = totals[1] / EA, totals[2] / EA
    EI_3 = totals[3] - EA * x2c ** 2
    EI_2 = totals[4] - EA * x3c ** 2
    EI_23 = totals[5] - EA * x2c * x3c

    # Principal stiffnesses: eigenvalues of the spread of stiffness about the centroid
    spread = np.array([[EI_3, EI_23], [EI_23, EI_2]])
    eig_values, eig_vectors = np.linalg.eigh(spread)
    EI_min, EI_max = eig_values
    if np.isclose(EI_max, EI_min, rtol=1e-9):
        principal_angle_deg = 0.0  # all axes equally stiff (e.g. a circle)
    else:
        n = eig_vectors[:, 1]  # direction the stiffness is spread furthest; the EI_max axis is perpendicular to it
        principal_angle_deg = np.degrees(np.arctan2(n[0], -n[1]))
        principal_angle_deg = (principal_angle_deg + 90) % 180 - 90  # an axis, so keep it in [-90, 90)

    print("Centroid (x2, x3) [m] is (" + str(round_sig(x2c, 4)) + ", " + str(round_sig(x3c, 4)) + ")")
    print("EI equivalent about x2 [N*m^2] is ", EI_2)
    print("EI equivalent about x3 [N*m^2] is ", EI_3)
    print("EI coupling term EI_23 [N*m^2] is ", EI_23)
    print("Principal EI [N*m^2]: max " + str(round_sig(EI_max, 5)) + ", min " + str(round_sig(EI_min, 5)) +
          ", EI_max axis at " + str(round_sig(principal_angle_deg, 4)) + " deg from x2")
    return {
        "EI_2": EI_2, "EI_3": EI_3, "EI_23": EI_23,
        "EI_max": EI_max, "EI_min": EI_min, "principal_angle_deg": principal_angle_deg,
        "centroid": (x2c, x3c), "EA": EA,
    }


def generate_torsion_circ_tube(A_matrix, inner_diameter, lu: pd.DataFrame, torque, axial_load=0.0):
    """
    Calculates the twist and axial strain of a thin-walled composite circular tube under torsion (and an optional
    axial load), using shear flow (MECH530 Lecture 21, "Composite Tube Torsion - Thin Walled Cross-section").
    Assumes the layup is symmetric. calculate_A_B_D_matrix() must be run prior to calling this function.

    With alpha = A^-1 (in-plane compliance of the laminate), r0 the mid-wall radius and t the wall thickness:

        shear flow                q = T / (2*pi*r0^2)                       (from T = int q*r0 ds)
        twist per unit length     r0 * dphi/dx1 = alpha16 * P/(2*pi*r0) + alpha66 * T/(2*pi*r0^2)
        axial strain              e1 = du/dx    = alpha11 * P/(2*pi*r0) + alpha16 * T/(2*pi*r0^2)

    For a balanced laminate alpha16 = 0, so the twist is dphi/dx1 = t*alpha66*T / J with J = 2*pi*r0^3*t, and
    torque causes no axial strain. For an unbalanced laminate alpha16 couples twist and extension.

    :param A_matrix: A_matrix [GPa*m or 10^9*N/m], from calculate_A_B_D_matrix()
    :param inner_diameter: The inside diameter of the tube [m]
    :param lu: layup dataframe, output of layup_create()
    :param torque: applied torque T (M11) about the tube axis [N*m]
    :param axial_load: applied axial force P [N], tension positive. Default 0
    :return: dict with
        "twist_rate": angle of twist per unit length dphi/dx1 [rad/m]
        "axial_strain": e1 [-]
        "shear_flow": q [N/m]
        "GJ_eq": torsional stiffness T / (dphi/dx1) with no axial load, = 2*pi*r0^3 / alpha66 [N*m^2]
    """
    h = lu["Thickness (m)"].sum()
    r0 = inner_diameter / 2 + h / 2  # mid-wall radius

    alpha = np.linalg.inv(A_matrix * 10 ** 9)  # in-plane compliance [m/N]
    alpha11, alpha16, alpha66 = alpha[0, 0], alpha[0, 2], alpha[2, 2]

    N_axial = axial_load / (2 * np.pi * r0)  # axial force per unit circumference [N/m]
    q = torque / (2 * np.pi * r0 ** 2)  # shear flow [N/m]

    twist_rate = (alpha16 * N_axial + alpha66 * q) / r0
    axial_strain = alpha11 * N_axial + alpha16 * q
    GJ_eq = 2 * np.pi * r0 ** 3 / alpha66

    print("Shear flow [N/m] is ", q)
    print("Angle of twist per unit length [rad/m] is ", twist_rate)
    print("Axial strain is ", axial_strain)
    print("GJ equivalent [N*m^2] is ", GJ_eq)
    return {"twist_rate": twist_rate, "axial_strain": axial_strain, "shear_flow": q, "GJ_eq": GJ_eq}


def generate_torsion_arbitrary_tube(csv_path, lu: pd.DataFrame, torque, axial_load=0.0, surface="inner"):
    """
    Calculates the twist and axial strain of a thin-walled composite tube with an arbitrary closed cross-section
    (e.g. an airfoil) under torsion and an optional axial load, using shear flow. Extends
    generate_torsion_circ_tube() (MECH530 Lecture 21, "Composite Tube Torsion - Thin Walled Cross-section") to any
    single-cell section. Assumes the layup is symmetric. calculate_A_B_D_matrix() must be run prior to calling
    this function.

    The CSV and surface options are the same as generate_EIeq_arbitrary_tube(). The wall is represented by its
    midline, the surface outline offset by half the layup thickness. With alpha = A^-1 (in-plane compliance of
    the laminate), A_m the area enclosed by the midline and S the midline perimeter:

        shear flow (constant around a closed cell)   q = T / (2*A_m)                  (from T = int q*r ds)
        axial force per unit length                  N1 = P / S
        twist per unit length                        dphi/dx1 = S * (alpha16*N1 + alpha66*q) / (2*A_m)
        axial strain                                 e1 = alpha11*N1 + alpha16*q

    The twist comes from adding up the wall shear strain gamma = alpha16*N1 + alpha66*q around the cell. For a
    circle A_m = pi*r0^2 and S = 2*pi*r0, which gives exactly the lecture's r0*dphi/dx1 = alpha16*P/(2*pi*r0) +
    alpha66*T/(2*pi*r0^2). For a balanced laminate alpha16 = 0, so torque causes no axial strain.

    Thin-wall theory: the wall must be thin compared with the size of the section. Where the plies from the two
    walls merge into solid laminate (e.g. at a sharp trailing edge), that solid part is not counted, which is
    slightly conservative.

    :param csv_path: path to the CSV file of surface points
    :param lu: layup dataframe, output of layup_create()
    :param torque: applied torque T (M11) about the tube axis [N*m]
    :param axial_load: applied axial force P [N], tension positive. Default 0
    :param surface: "inner" if the points are the inner surface of the tube, "outer" if they are the outer surface
    :return: dict with
        "twist_rate": angle of twist per unit length dphi/dx1 [rad/m]
        "axial_strain": e1 [-]
        "shear_flow": q [N/m]
        "GJ_eq": torsional stiffness T / (dphi/dx1) with no axial load, = 4*A_m^2 / (alpha66*S) [N*m^2]
        "enclosed_area": A_m [m^2]
        "perimeter": S [m]
    """
    px, py = _section_read_csv(csv_path, surface)
    h = lu["Thickness (m)"].sum()

    # wall midline: half the layup thickness from the surface in the CSV
    mx, my = _section_checked_offset(px, py, h / 2 if surface == "inner" else -h / 2, surface, h)
    if len(mx) == 0:
        raise ValueError("The section is solid (the hollow closes up), so thin-walled shear flow does not apply")
    A_m = _section_polygon_moments(mx, my)[0]
    S = np.sum(np.hypot(np.roll(mx, -1) - mx, np.roll(my, -1) - my))

    # in-plane compliance of the laminate, alpha = A^-1 [m/N], with A built the same way as calculate_A_B_D_matrix()
    A_matrix = sum(row["Q matrix off"] * row["Thickness (m)"] for _, row in lu.iterrows()) * 10 ** 9
    alpha = np.linalg.inv(A_matrix)
    alpha11, alpha16, alpha66 = alpha[0, 0], alpha[0, 2], alpha[2, 2]

    N_axial = axial_load / S  # axial force per unit length of wall [N/m]
    q = torque / (2 * A_m)  # shear flow [N/m]

    twist_rate = S * (alpha16 * N_axial + alpha66 * q) / (2 * A_m)
    axial_strain = alpha11 * N_axial + alpha16 * q
    GJ_eq = 4 * A_m ** 2 / (alpha66 * S)

    print("Enclosed area of wall midline [m^2] is ", A_m)
    print("Perimeter of wall midline [m] is ", S)
    print("Shear flow [N/m] is ", q)
    print("Angle of twist per unit length [rad/m] is ", twist_rate)
    print("Axial strain is ", axial_strain)
    print("GJ equivalent [N*m^2] is ", GJ_eq)
    return {"twist_rate": twist_rate, "axial_strain": axial_strain, "shear_flow": q, "GJ_eq": GJ_eq,
            "enclosed_area": A_m, "perimeter": S}


# Vibration helpers, used by generate_natural_frequencies_tube()
_BEAM_BOUNDARIES = ("clamped-free", "pinned-pinned", "clamped-clamped", "free-free", "clamped-pinned")


def _beam_mode_roots(boundary, n_modes):
    """
    Private function, returns the first n_modes roots beta_n*L of the Euler-Bernoulli beam characteristic equation.
    Each root is found by bisection in an interval that holds exactly one root (no scipy, so it runs in Pyodide).
    The equations are divided through by cosh(x) so they stay well conditioned for high modes.

        clamped-free     cos x cosh x = -1   ->  g(x) = cos x + 1/cosh x,           root n in [(n-1)pi, n pi]
        clamped-clamped  cos x cosh x = +1   ->  g(x) = cos x - 1/cosh x,           root n in [n pi, (n+1)pi]
        free-free        same roots as clamped-clamped (rigid-body modes at 0 excluded)
        clamped-pinned   tan x = tanh x      ->  g(x) = sin x - cos x * tanh x,     root n in [n pi, n pi + pi/2]
        pinned-pinned    sin x = 0           ->  x = n pi exactly
    """
    def bisect(g, lo, hi):
        g_lo = g(lo)
        for _ in range(200):
            mid = 0.5 * (lo + hi)
            g_mid = g(mid)
            if g_lo * g_mid <= 0:
                hi = mid
            else:
                lo, g_lo = mid, g_mid
        return 0.5 * (lo + hi)

    roots = []
    for n in range(1, n_modes + 1):
        if boundary == "pinned-pinned":
            roots.append(n * np.pi)
        elif boundary == "clamped-free":
            roots.append(bisect(lambda x: np.cos(x) + 1 / np.cosh(x), (n - 1) * np.pi, n * np.pi))
        elif boundary in ("clamped-clamped", "free-free"):
            roots.append(bisect(lambda x: np.cos(x) - 1 / np.cosh(x), n * np.pi, (n + 1) * np.pi))
        elif boundary == "clamped-pinned":
            roots.append(bisect(lambda x: np.sin(x) - np.cos(x) * np.tanh(x), n * np.pi, n * np.pi + np.pi / 2))
    return np.array(roots)


def generate_natural_frequencies_tube(EI, lu: pd.DataFrame, length, inner_diameter=None, perimeter=None,
                                      GJ=None, EA=None, boundary="clamped-free", n_modes=3):
    """
    Calculates the natural frequencies [Hz] of a composite tube treated as a uniform beam: bending modes
    (Euler-Bernoulli), torsion modes and axial modes. Assumes the layup is symmetric.
    calculate_A_B_D_matrix() must be run prior to calling this function.

    Mass per unit length m [kg/m]:
        circular tube (inner_diameter given)  m = sum_k rho_k * pi * ((Ri + t_k)^2 - (Ri + t_k-1)^2)    (exact)
        any other tube (perimeter given)      m = (sum_k rho_k * thickness_k) * S                         (thin wall)
    where S is the mid-wall perimeter, e.g. "perimeter" from generate_torsion_arbitrary_tube(), or
    2*(in_width + in_height) + 4*h for a rectangular tube with inside dimensions in_width x in_height.

    Bending (Euler-Bernoulli beam):
        omega_n = (beta_n*L)^2 / L^2 * sqrt(EI / m),    f_n = omega_n / (2*pi)
    with beta_n*L the roots of the characteristic equation for the supports:
        "clamped-free"    (cantilever)   cos(bL)cosh(bL) = -1   1.8751, 4.6941, 7.8548, ...
        "pinned-pinned"                  sin(bL) = 0             pi, 2pi, 3pi, ...
        "clamped-clamped"                cos(bL)cosh(bL) = 1    4.7300, 7.8532, 10.9956, ...
        "free-free"                      cos(bL)cosh(bL) = 1    same as clamped-clamped, rigid-body modes excluded
        "clamped-pinned"                 tan(bL) = tanh(bL)     3.9266, 7.0686, 10.2102, ...

    Torsion and axial (uniform shaft / bar, wave equation):
        omega_n = lambda_n / L * sqrt(GJ / Ip)     and     omega_n = lambda_n / L * sqrt(EA / m)
    with lambda_n = (2n-1)*pi/2 when one end is held and the other free ("clamped-free"), and n*pi when both ends
    are held or both are free. For these modes a pinned end is taken to restrain twist and axial motion.
    Ip is the polar mass moment of inertia per unit length, sum_k rho_k * pi/2 * ((Ri + t_k)^4 - (Ri + t_k-1)^4),
    so torsion modes need inner_diameter. EA is taken from EI when EI is the dict from
    generate_EIeq_arbitrary_tube(), and is calculated from the layup for a circular tube when not given.

    Limits: no shear deformation or rotary inertia (results run high for short tubes, L/D below about 10, and for
    higher modes), no damping, ideal supports, and no bending-torsion coupling from unbalanced layups (A16 != 0) or
    unsymmetric sections (EI_23 != 0). Core layers made with zc in layup_create() have zero density, so a sandwich
    wall's core mass is not included.

    :param EI: bending stiffness [N*m^2], e.g. from generate_Dx_eq_circ_tube() or generate_EIeq_rect_tube(); or the
               dict returned by generate_EIeq_arbitrary_tube(), in which case both principal axes are calculated
    :param lu: layup dataframe, output of layup_create()
    :param length: length of the tube between supports [m]
    :param inner_diameter: inside diameter of a circular tube [m]. Give this or perimeter
    :param perimeter: mid-wall perimeter of a non-circular tube [m]. Give this or inner_diameter
    :param GJ: torsional stiffness [N*m^2], e.g. "GJ_eq" from generate_torsion_circ_tube(). Optional
    :param EA: axial stiffness [N]. Optional
    :param boundary: one of "clamped-free", "pinned-pinned", "clamped-clamped", "free-free", "clamped-pinned"
    :param n_modes: number of modes to calculate for each type
    :return: dict with
        "f_bending": bending frequencies [Hz], from EI (or from EI_max for an arbitrary section)
        "f_bending_min": bending frequencies about the EI_min axis [Hz] for an arbitrary section, else None
        "f_torsion": torsion frequencies [Hz], or None
        "f_axial": axial frequencies [Hz], or None
        "beta_L": the beta_n*L roots used for bending
        "mass_per_length": m [kg/m]
        "polar_inertia_per_length": Ip [kg*m], or None
    """
    if boundary not in _BEAM_BOUNDARIES:
        raise ValueError("boundary must be one of " + ", ".join(_BEAM_BOUNDARIES))
    if (inner_diameter is None) == (perimeter is None):
        raise ValueError("Give exactly one of inner_diameter (circular tube) or perimeter (any other tube)")
    n_modes = int(n_modes)
    if n_modes < 1:
        raise ValueError("n_modes must be at least 1")
    L = float(length)

    EI_min = None
    if isinstance(EI, dict):
        if EA is None:
            EA = EI["EA"]
        EI_min = EI["EI_min"]
        EI = EI["EI_max"]

    h = lu["Thickness (m)"].sum()
    rho = np.array([m.rho for m in lu["Material"]])
    is_core = np.array([m.name == "Core" for m in lu["Material"]])

    # Mass per unit length (and polar mass inertia for a circular tube)
    Ip = None
    if inner_diameter is not None:
        Ri = inner_diameter / 2
        # distance of each layer's outer and inner face from the inner surface; layer 1 is the outermost ply
        r_out = Ri + lu["TopHeight"].to_numpy() + h / 2
        r_in = Ri + lu["BottomHeight"].to_numpy() + h / 2
        m = np.sum(rho * np.pi * (r_out ** 2 - r_in ** 2))
        Ip = np.sum(rho * np.pi / 2 * (r_out ** 4 - r_in ** 4))
        if EA is None:
            q11 = np.array([Q[0, 0] for Q in lu["Q matrix off"]]) * 10 ** 9
            EA = np.sum(np.where(is_core, 0.0, q11) * np.pi * (r_out ** 2 - r_in ** 2))
        outer_size = inner_diameter + 2 * h
    else:
        m = np.sum(rho * lu["Thickness (m)"].to_numpy()) * perimeter
        outer_size = perimeter / np.pi  # diameter of a circle with the same perimeter, for the slenderness check
    if m <= 0:
        raise ValueError("Mass per unit length is zero; check the material densities")

    # Bending
    beta_L = _beam_mode_roots(boundary, n_modes)
    def bending(EI_value):
        return [float(f) for f in beta_L ** 2 / L ** 2 * np.sqrt(EI_value / m) / (2 * np.pi)]
    f_bending = bending(EI)
    f_bending_min = bending(EI_min) if EI_min is not None else None

    # Torsion and axial
    n = np.arange(1, n_modes + 1)
    lam = (2 * n - 1) * np.pi / 2 if boundary == "clamped-free" else n * np.pi
    f_torsion = None
    if GJ is not None:
        if Ip is None:
            raise ValueError("Torsion modes need inner_diameter (the polar mass inertia of the section)")
        f_torsion = [float(f) for f in lam / L * np.sqrt(GJ / Ip) / (2 * np.pi)]
    f_axial = [float(f) for f in lam / L * np.sqrt(EA / m) / (2 * np.pi)] if EA is not None else None

    def fmt(freqs):
        return ", ".join(str(round_sig(f, 4)) for f in freqs)
    print("Mass per unit length [kg/m] is ", m)
    print("Bending natural frequencies (" + boundary + ") [Hz]: " + fmt(f_bending))
    if f_bending_min is not None:
        print("Bending natural frequencies about EI_min axis [Hz]: " + fmt(f_bending_min))
    if f_torsion is not None:
        print("Torsion natural frequencies [Hz]: " + fmt(f_torsion))
    if f_axial is not None:
        print("Axial natural frequencies [Hz]: " + fmt(f_axial))
    if L / outer_size < 10:
        print("Warning: L/D is " + str(round_sig(L / outer_size, 3)) + "; below about 10, shear deformation and "
              "rotary inertia lower the bending frequencies, so these results run high")
    if is_core.any():
        print("Warning: core layers have zero density, so the core's mass is not included")

    return {"f_bending": f_bending, "f_bending_min": f_bending_min, "f_torsion": f_torsion, "f_axial": f_axial,
            "beta_L": [float(b) for b in beta_L], "mass_per_length": float(m),
            "polar_inertia_per_length": None if Ip is None else float(Ip)}


def generate_natural_frequencies_plate(D_matrix, lu: pd.DataFrame, a, b, n_modes=5, B_matrix=None):
    """
    Calculates the natural frequencies [Hz] of a flat rectangular laminate a x b, simply supported on all four
    edges, using classical laminated plate theory (Navier solution, Whitney & Leissa).
    calculate_A_B_D_matrix() must be run prior to calling this function.

    The equation of motion of a specially orthotropic plate (B = 0, D16 = D26 = 0) is

        D11 w,xxxx + 2(D12 + 2 D66) w,xxyy + D22 w,yyyy + rho_A w,tt = 0

    and the mode shape w = sin(m pi x / a) sin(n pi y / b) satisfies it and the simply supported edges exactly, so

        omega_mn = pi^2 * sqrt( [D11 (m/a)^4 + 2(D12 + 2 D66)(m/a)^2 (n/b)^2 + D22 (n/b)^4] / rho_A ),
        f_mn = omega_mn / (2 pi),     rho_A = sum_k rho_k * thickness_k   (mass per unit area)

    m and n are the number of half-waves along x (length a, the 0 deg ply direction) and y (length b).
    The modes are returned lowest first; the fundamental is usually m = n = 1.

    The result is exact for symmetric cross-ply laminates. For other layups it is an estimate:
      - D16, D26 != 0 (angle plies, e.g. +-45): bending-twisting coupling makes the real plate softer, so these
        frequencies run high. The error grows with |D16|, |D26| and falls as the number of plies grows.
        A warning is printed when either is more than 5% of sqrt(D11*D22).
      - B != 0 (unsymmetric layup): bending-stretching coupling also lowers the frequencies. Pass B_matrix to
        get a warning when it is not zero.
    Other limits: thin plates only (no transverse shear deformation or rotary inertia, so results run high when
    a/h or b/h is below about 20, and for sandwich plates with a soft core), no damping, ideal supports. Core
    layers made with zc in layup_create() have zero density, so the core's mass is not included.

    :param D_matrix: D_matrix [Nm], from calculate_A_B_D_matrix()
    :param lu: layup dataframe, output of layup_create()
    :param a: plate length along x, the laminate 0 deg direction [m]
    :param b: plate width along y [m]
    :param n_modes: number of modes to return
    :param B_matrix: B_matrix [N], from calculate_A_B_D_matrix(). Optional, only used for the coupling warning
    :return: dict with
        "frequencies": the lowest n_modes natural frequencies [Hz], lowest first
        "modes": the (m, n) half-wave numbers of each frequency
        "areal_mass": rho_A [kg/m^2]
        "D16_ratio", "D26_ratio": |D16| / sqrt(D11*D22) and |D26| / sqrt(D11*D22); near 0 means the result is exact
    """
    n_modes = int(n_modes)
    if n_modes < 1:
        raise ValueError("n_modes must be at least 1")
    if a <= 0 or b <= 0:
        raise ValueError("Plate dimensions a and b must be positive")

    h = lu["Thickness (m)"].sum()
    areal_mass = float(sum(row["Thickness (m)"] * row["Material"].rho for _, row in lu.iterrows()))
    if areal_mass <= 0:
        raise ValueError("Mass per unit area is zero; check the material densities")

    D11, D22, D12, D66 = D_matrix[0][0], D_matrix[1][1], D_matrix[0][1], D_matrix[2][2]
    D16, D26 = D_matrix[0][2], D_matrix[1][2]

    # Frequency rises with both m and n, so the lowest n_modes modes all have m, n <= n_modes
    mn = np.arange(1, n_modes + 1)
    M, N = np.meshgrid(mn, mn, indexing="ij")
    ka, kb = M / a, N / b
    stiffness = D11 * ka ** 4 + 2 * (D12 + 2 * D66) * ka ** 2 * kb ** 2 + D22 * kb ** 4
    f = np.pi ** 2 * np.sqrt(stiffness / areal_mass) / (2 * np.pi)
    order = np.argsort(f, axis=None, kind="stable")[:n_modes]
    frequencies = [float(x) for x in f.ravel()[order]]
    modes = [(int(M.ravel()[i]), int(N.ravel()[i])) for i in order]

    D_ref = np.sqrt(D11 * D22)
    D16_ratio, D26_ratio = float(abs(D16) / D_ref), float(abs(D26) / D_ref)

    print("Mass per unit area [kg/m^2] is ", areal_mass)
    print("Natural frequencies, simply supported " + str(round_sig(a, 4)) + " x " + str(round_sig(b, 4)) + " m plate:")
    for (m_hw, n_hw), freq in zip(modes, frequencies):
        print("  mode (" + str(m_hw) + "," + str(n_hw) + "): " + str(round_sig(freq, 4)) + " Hz")
    if max(D16_ratio, D26_ratio) > 0.05:
        print("Warning: bending-twisting coupling is significant (|D16|/sqrt(D11*D22) = " + str(round_sig(D16_ratio, 3)) +
              ", |D26|/sqrt(D11*D22) = " + str(round_sig(D26_ratio, 3)) + "); the real frequencies are lower than these")
    if B_matrix is not None and np.max(np.abs(B_matrix)) > 1e-9 * max(np.max(np.abs(D_matrix)) / h, 1e-30):
        print("Warning: B is not zero (unsymmetric layup); bending-stretching coupling makes the real frequencies lower")
    if min(a, b) / h < 20:
        print("Warning: the plate is thick (min(a, b)/h = " + str(round_sig(min(a, b) / h, 3)) + "); without shear "
              "deformation these results run high")
    if any(m.name == "Core" for m in lu["Material"]):
        print("Warning: core layers have zero density and the core's shear flexibility is ignored; results run high")

    return {"frequencies": frequencies, "modes": modes, "areal_mass": areal_mass,
            "D16_ratio": D16_ratio, "D26_ratio": D26_ratio}


# Failure criteria helpers, used by calculate_safety_factors()
def _strain_off_to_on(ply_angle, strain_off_axis):
    """
    Private function, uses ply angle to calculate on-axis strain from off-axis strain
    :param ply_angle: orientation of the ply [deg]
    :param strain_off_axis: off-axis strain vector [εx, εy, εs] (engineering shear strain)
    :return: on-axis strain vector [ε1, ε2, ε6]
    """
    m = round_sig(math.cos(math.radians(ply_angle)), 6)
    n = round_sig(math.sin(math.radians(ply_angle)), 6)

    # helper variables to speed up arrays
    m2 = round_sig(m * m, 6)
    n2 = round_sig(n * n, 6)
    mn = m * n

    strain_off_to_on_matrix = np.array([[m2, n2, mn],
                                        [n2, m2, -1 * mn],
                                        [-2 * mn, 2 * mn, m2 - n2]])

    return strain_off_to_on_matrix @ strain_off_axis

def _maximum_stress_criterion(material: Material, stresses):
    """
    Private function, calculates safety factor R using the max stress criterion
    :param material: material of the layer
    :param stresses: on-axis stress vector [GPa]
    :return: R for [fiber tension, fiber compression, matrix tension, matrix compression, shear].
    None where that mode is not loaded
    """
    σx = stresses[0]
    σy = stresses[1]
    σs = stresses[2]

    stress_criterion_R_list = [None, None, None, None, None]

    # strengths converted from MPa to GPa
    if σx > 0:
        stress_criterion_R_list[0] = ((material.Xt / 1000) / σx)
    if σx < 0:
        stress_criterion_R_list[1] = ((material.Xc / 1000) / abs(σx))
    if σy > 0:
        stress_criterion_R_list[2] = ((material.Yt / 1000) / σy)
    if σy < 0:
        stress_criterion_R_list[3] = ((material.Yc / 1000) / abs(σy))
    if σs != 0:
        stress_criterion_R_list[4] = ((material.Sc / 1000) / abs(σs))

    return stress_criterion_R_list

def _tsai_wu_quadratic_criterion(material: Material, stresses):
    """
    Private function, calculates R using the Tsai-Wu quadratic interaction criterion
    a*R^2 + b*R - 1 = 0, with F*xy = -0.5 (eq 7.15, 7.22)
    :param material: material of the layer
    :param stresses: on-axis stress vector [GPa]
    :return: R (positive root). None if the ply is unloaded
    """
    σx = stresses[0] * 1000  # convert from GPa to MPa
    σy = stresses[1] * 1000
    σs = stresses[2] * 1000

    Fxx = 1 / (material.Xt * material.Xc)  # 1/MPa^2
    Fx = 1 / material.Xt - 1 / material.Xc  # 1/MPa
    Fyy = 1 / (material.Yt * material.Yc)  # 1/Mpa^2
    Fy = 1 / material.Yt - 1 / material.Yc  # 1/MPa
    Fss = 1 / (material.Sc ** 2)  # 1/MPa^2
    F_star_xy = -0.5  # from lecture 12 slide 12, also eq 7.22
    Fxy = F_star_xy * math.sqrt((Fxx * Fyy))  # from eq 7.15

    a = Fxx * σx * σx + 2 * Fxy * σx * σy + Fyy * σy * σy + Fss * σs * σs
    b = Fx * σx + Fy * σy
    c = -1.0

    if a == 0:
        return 1 / b if b > 0 else None

    dis = (b ** 2) - (4 * a * c)
    R = (-b + math.sqrt(dis)) / (2 * a)

    return R

def _hashin_failure_criteria(material: Material, stresses):
    """
    Private function, calculates R using the Hashin failure criteria
    :param material: material of the layer
    :param stresses: on-axis stress vector [GPa]
    :return: R for [fiber tension, fiber compression, matrix tension, matrix compression].
    None where that mode is not loaded
    """
    σx = stresses[0] * 1000  # convert stresses back to MPa
    σy = stresses[1] * 1000
    σs = stresses[2] * 1000

    # FIBER TENSION
    if σx > 0:
        failure_index_ft = (material.Sc * material.Xt) / math.sqrt(
            σx ** 2 * material.Sc ** 2 + material.Xt ** 2 * σs ** 2)
    else:
        failure_index_ft = None

    # FIBER COMPRESSION
    if σx < 0:
        failure_index_fc = (-material.Xc) / σx
    else:
        failure_index_fc = None

    # MATRIX TENSION
    if σy > 0:
        failure_index_mt = (material.Sc * material.Yt) / math.sqrt(
            σs ** 2 * material.Yt ** 2 + material.Sc ** 2 * σy ** 2)
    else:
        failure_index_mt = None

    # MATRIX COMPRESSION
    if σy < 0:
        failure_index_mc = (math.sqrt(
            64 * material.Sc ** 2 * material.Yc ** 2 * σs ** 2 + 8 * σy ** 2 * material.Sc ** 2 * material.Yc ** 2
            + σy ** 2 * material.Yc ** 4 + 16 * σy ** 2 * material.Sc ** 4)
                            + 4 * σy * material.Sc ** 2 - σy * material.Yc ** 2) / (
                                   2 * material.Yc * (4 * σs ** 2 + σy ** 2))
    else:
        failure_index_mc = None

    return [failure_index_ft, failure_index_fc, failure_index_mt, failure_index_mc]

def calculate_safety_factors(lu: pd.DataFrame, applied_stress: np.ndarray, applied_moment: np.ndarray):
    """
    Calculates the safety factors R at the top and bottom of every ply in a layup using the maximum stress,
    Tsai-Wu quadratic and Hashin failure criteria. R is the factor the applied loads can be multiplied by before
    the ply fails. Prints the table of safety factors and the first ply failure for each criterion.

    Mid-plane strains and curvatures come from the full [A B; B D] matrix, so unsymmetric layups are handled.
    Layer 1 is at the top of the laminate (z = +h/2), matching calculate_A_B_D_matrix(). Core layers are skipped.

    :param lu: layup dataframe, output of layup_create()
    :param applied_stress: applied stress resultant [N1, N2, N6] per unit length [Pa m or N/m] in the laminate coordinate system
    :param applied_moment: applied moment resultant [M1, M2, M6] per unit length [N or Nm/m] in the laminate coordinate system
    :return: dataframe with one row per ply surface ("Layer #", "T/B") and the safety factor for each failure mode:
        Max_FT, Max_FC, Max_MT, Max_MC, Max_S (maximum stress), Quad (Tsai-Wu), Hash_FT, Hash_FC, Hash_MT, Hash_MC
        (Hashin). FT/FC fiber tension/compression, MT/MC matrix tension/compression, S shear. NaN if mode not loaded.
    """
    applied_stress = np.asarray(applied_stress, dtype=float)
    applied_moment = np.asarray(applied_moment, dtype=float)

    # Also adds the Q matrix and TopHeight/BottomHeight columns used below
    A_matrix, B_matrix, D_matrix = calculate_A_B_D_matrix(lu)

    # Mid-plane strains and curvatures, all in SI units: A [N/m], B [N], D [Nm]
    ABD_matrix = np.block([
        [A_matrix * 10 ** 9, B_matrix],
        [B_matrix, D_matrix]
    ])
    strains_curvatures = np.linalg.inv(ABD_matrix) @ np.concatenate([applied_stress, applied_moment])
    planar_off_axis_strains = strains_curvatures[:3]
    k_list = strains_curvatures[3:]  # [1/m]

    # Safety factors at the top and bottom surface of each ply
    max_cols = ["Max_FT", "Max_FC", "Max_MT", "Max_MC", "Max_S"]
    quad_cols = ["Quad"]
    hash_cols = ["Hash_FT", "Hash_FC", "Hash_MT", "Hash_MC"]

    data = []
    for _, layer in lu[lu["Material_name"] != "Core"].iterrows():
        for location, z in [("Top", layer["TopHeight"]), ("Bottom", layer["BottomHeight"])]:
            off_axis_strains = planar_off_axis_strains + z * k_list
            on_axis_strains = _strain_off_to_on(layer["Orientation (deg)"], off_axis_strains)
            on_axis_stress = layer["Q matrix"] @ on_axis_strains  # [GPa]
            # round-off noise (e.g. shear in a 0 deg ply under N1) would otherwise give huge R instead of None
            on_axis_stress[np.abs(on_axis_stress) < 1e-9 * np.max(np.abs(on_axis_stress))] = 0.0

            row = {"Layer #": layer["Layer #"], "T/B": location}
            row.update(zip(max_cols, _maximum_stress_criterion(layer["Material"], on_axis_stress)))
            row.update(zip(quad_cols, [_tsai_wu_quadratic_criterion(layer["Material"], on_axis_stress)]))
            row.update(zip(hash_cols, _hashin_failure_criteria(layer["Material"], on_axis_stress)))
            data.append(row)

    sf = pd.DataFrame(data)
    cols = max_cols + quad_cols + hash_cols
    sf[cols] = sf[cols].astype(float)

    # rounded so that plies with equal R up to round-off are reported in layer order
    sf_rounded = sf.copy()
    sf_rounded[cols] = sf_rounded[cols].map(lambda x: round_sig(x, 6))

    print("\nThe Table of Safety Factors is:")
    print("Top of Laminate")
    print(tabulate(sf_rounded, headers="keys", tablefmt="psql"))
    print("Bottom of Laminate")
    print()

    lowest_R_list = []
    for criterion, criterion_cols, prefix in [("maximum stress", max_cols, "Max_"),
                                              ("Quadratic Polynomial", quad_cols, "Quad"),
                                              ("Hashin", hash_cols, "Hash_")]:
        print("According to " + criterion + " criteria: ")
        if sf_rounded[criterion_cols].isna().all().all():
            print("No ply is loaded")
            print()
            continue
        lowest_R = sf_rounded[criterion_cols].min().min()
        lowest_R_mode = sf_rounded[criterion_cols].min().idxmin()
        lowest_R_index = sf_rounded[lowest_R_mode].idxmin()
        lowest_R_layer = sf_rounded.at[lowest_R_index, "Layer #"]
        lowest_R_location = sf_rounded.at[lowest_R_index, "T/B"].lower()
        failure_mode = lowest_R_mode[len(prefix):]
        print("Layer " + str(lowest_R_layer) + " (" + lowest_R_location + ") will fail first"
              + (" in " + failure_mode if failure_mode else "") + " with an R of " + str(round_sig(lowest_R, 6)))
        print("Stress vector at failure: " + str([round_sig(float(x * lowest_R)) for x in applied_stress]))
        print("Moment vector at failure: " + str([round_sig(float(x * lowest_R)) for x in applied_moment]))
        print()
        lowest_R_list.append(lowest_R)

    if lowest_R_list:
        print("MINIMUM SF IS: " + str(round_sig(min(lowest_R_list), 6)))

    return sf