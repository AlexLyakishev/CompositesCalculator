# import libraries
import csv
from operator import invert

import pandas as pd
from tabulate import tabulate
import math
import numpy as np

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
    :return: A_matrix [GPa*m or 10^9*N/m], B_matrix [Nm/m], D_matrix [Nm]
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

    lu_roundtube = lu[lu["Material"] != "Core"].copy()

    lu_roundtube["off_axis_q11"] = np.array([Q[0, 0] for Q in lu["Q matrix off"]])

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
