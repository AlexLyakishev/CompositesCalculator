# import libraries
import csv
from operator import invert

import pandas as pd
from tabulate import tabulate
import math
import numpy as np

# COMPOSITE CALCULATOR LIBRARY by Alex L
# mind the version number, this is a work in progress and will be updated frequently
version = 1.1
update_date = "2026-11-05"

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
